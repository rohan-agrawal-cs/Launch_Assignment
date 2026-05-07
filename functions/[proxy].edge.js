import jwt from "@tsndr/cloudflare-worker-jwt";

/** Cloudflare sets `request.cf.country`; fall back to headers some stacks inject. */
function getVisitorCountry(request) {
  const cfCountry = request.cf?.country;
  if (typeof cfCountry === "string" && cfCountry.length > 0) {
    return cfCountry;
  }
  const cfHeader = request.headers.get("CF-IPCountry");
  if (cfHeader) return cfHeader.trim();
  const visitor = request.headers.get("visitor-ip-country");
  if (visitor) return visitor.trim();
  return "US";
}

/** Origin fetch for cacheable HTML: drop headers that make CF skip cache / vary by user. */
function forwardOriginForEdgeCache(request, upstreamUrl) {
  const h = new Headers(request.headers);
  for (const name of [
    "cookie",
    "Cookie",
    "authorization",
    "Authorization",
    "cache-control",
    "Cache-Control",
    "pragma",
    "Pragma",
  ]) {
    h.delete(name);
  }
  const init = {
    method: request.method,
    headers: h,
    redirect: request.redirect,
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }
  return new Request(upstreamUrl, init);
}

export default async function handler(request, context) {
  const url = new URL(request.url);
  const hostname = url.hostname;
  const pathname = url.pathname;

  // ============================================
  // PASSWORD PROTECTION FOR TEST DOMAINS
  // ============================================

  const testDomains = ["launchassignment-test.contentstackapps.com"];

  const isTestDomain = testDomains.some((domain) => hostname.includes(domain));

  // Password-protect homepage on test domains
  if (pathname === "/" && isTestDomain) {
    const passwordProtection = {
      username: context.env.BASIC_AUTH_USER,
      password: context.env.BASIC_AUTH_PASS,
    };

    const authResponse = handlePasswordProtection(request, passwordProtection);

    if (authResponse) {
      return authResponse; // Return 401 if auth failed
    }
  }

  // ============================================
  // LOCALE DETECTION & ROUTING (BASED ON COUNTRY)
  // ============================================

  const country = getVisitorCountry(request);

  // Only redirect India users, let everyone else pass through normally
  if (country === "IN" && pathname === "/") {
    console.log(`[LOCALE] Setting hi-in cookie for India user on homepage`);

    // Set cookie without redirecting - user stays on /
    const response = await fetch(request);
    const modifiedResponse = new Response(response.body, response);
    modifiedResponse.headers.set(
      "Set-Cookie",
      "NEXT_LOCALE=hi-in; Path=/; Max-Age=31536000",
    );
    return modifiedResponse;
  }

  // ============================================
  // SMART CACHING POLICY (TOP LEVEL)
  // ============================================

  let cacheControl = null;

  if (pathname === "/blog/latest") {
    cacheControl = "public, max-age=30, stale-while-revalidate=30";
  } else if (pathname.startsWith("/blog/") && pathname !== "/blog/latest") {
    cacheControl = "public, max-age=600, stale-while-revalidate=300";
  }

  // ============================================
  // EDGE LOCALE DEMO — /edge-locale-demo
  // Internal rewrite: origin sees ?locale=… from geo (IN → hi-in, else en-us).
  // URL in the browser stays /edge-locale-demo (no redirect). If ?locale= is
  // already present, it is forwarded unchanged.
  // ============================================
  if (pathname === "/edge-locale-demo") {
    const upstream = new URL(request.url);
    if (!upstream.searchParams.has("locale")) {
      const geo = getVisitorCountry(request);
      const inferred = geo === "IN" ? "hi-in" : "en-us";
      upstream.searchParams.set("locale", inferred);
      console.log(
        `[EDGE_LOCALE_DEMO] rewrite → ${upstream.pathname}${upstream.search} (country=${geo})`,
      );
    } else {
      console.log(
        `[EDGE_LOCALE_DEMO] passthrough locale=${upstream.searchParams.get("locale")}`,
      );
    }
    const demoCache =
      "public, max-age=60, stale-while-revalidate=300, s-maxage=60";
    // Same browser URL (/edge-locale-demo) for IN vs US would share one CDN
    // entry by default. cf.cacheKey ties the edge cache to the rewritten URL
    // (includes ?locale=) so each locale is cached separately.
    const originReq = forwardOriginForEdgeCache(request, upstream);
    return fetchWithCache(
      originReq,
      demoCache,
      { cacheKey: upstream.toString(), cacheEverything: true },
      { stripSetCookie: true },
    );
  }

  // ============================================
  // TRIGGER CONTENTSTACK AUTOMATE FROM BUTTON
  // ============================================

  if (url.pathname === "/automate/trigger" && request.method === "POST") {
    const pathToRevalidate = url.searchParams.get("path");

    if (!pathToRevalidate) {
      return new Response(JSON.stringify({ error: "Missing path parameter" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log("[AUTOMATE] Triggering webhook for:", pathToRevalidate);

    await fetch(
      "https://app.contentstack.com/automations-api/run/d457657f24f847458b7d62c48008228a",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathToRevalidate }),
      },
    );

    return new Response(
      JSON.stringify({
        message: `Automate triggered for ${pathToRevalidate}`,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // ============================================
  // IP WHITELISTING (ONLY FOR /editor-dashboard)
  // ============================================

  if (request.url.includes("/editor-dashboard")) {
    const allowedIPs = [
      "127.0.0.1",
      "::1",
      "154.84.245.58",
      "34.206.81.169",
      "27.107.90.206",
    ];

    const clientIP = request.headers.get("x-forwarded-for") || "";
    const clientIPList = clientIP.split(",").map((ip) => ip.trim());

    const allowed = clientIPList.some((ip) => allowedIPs.includes(ip));

    if (!allowed) {
      return new Response(
        JSON.stringify({
          error: "Forbidden",
          message: "Your IP address is not in the whitelist.",
          your_ip: clientIPList[0],
          timestamp: new Date().toISOString(),
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    return fetchWithCache(request, cacheControl);
  }

  // ============================================
  // REWRITE LOGIC - ONLY FOR PRODUCTION DOMAIN
  // ============================================

  const productionDomains = ["launchassignment-b6f4d9.contentstackapps.com"];

  const isProductionDomain = productionDomains.some((domain) =>
    hostname.includes(domain),
  );

  if (pathname === "/latest" && isProductionDomain) {
    const rewriteUrl = new URL(request.url);
    rewriteUrl.pathname = "/blog/latest";
    return fetchWithCache(new Request(rewriteUrl, request), cacheControl);
  }

  // ============================================
  // CDN ASSET PROXY (/cdn-assets/* -> Contentstack)
  // ============================================

  // if (pathname.startsWith("/cdn-assets/")) {
  //   // Extract filename from path: /cdn-assets/logo.png -> logo.png
  //   const filename = pathname.replace("/cdn-assets/", "");

  //   // Construct Contentstack asset URL
  //   const targetImage =
  //     `https://images.contentstack.io/v3/assets/${filename}`;

  //   console.log(`[CDN PROXY] Fetching: ${filename} from Contentstack`);

  //   try {
  //     const res = await fetch(targetImage);

  //     if (!res.ok) {
  //       console.error(`[CDN PROXY] Failed to fetch ${filename}: ${res.status}`);
  //       return new Response('Asset not found', { status: 404 });
  //     }

  //     return new Response(res.body, {
  //       status: 200,
  //       headers: {
  //         "Content-Type": res.headers.get("Content-Type") || "image/png",
  //         "Cache-Control": "public, max-age=86400",
  //         "Access-Control-Allow-Origin": "*"
  //       }
  //     });
  //   } catch (error) {
  //     console.error(`[CDN PROXY] Error fetching ${filename}:`, error);
  //     return new Response('Error fetching asset', { status: 502 });
  //   }
  // }

  // ============================================
  // OAUTH CREDENTIALS
  // ============================================

  const oauthCredentials = {
    OAUTH_CLIENT_ID: context.env.OAUTH_CLIENT_ID,
    OAUTH_CLIENT_SECRET: context.env.OAUTH_CLIENT_SECRET,
    OAUTH_REDIRECT_URI: context.env.OAUTH_REDIRECT_URI,
    OAUTH_TOKEN_URL: context.env.OAUTH_TOKEN_URL,
  };

  // Skip auth for static assets
  if (request.url.includes("_next") || request.url.includes("favicon.ico")) {
    return fetchWithCache(request, cacheControl);
  }

  // Allow login page
  if (request.url.includes("/login")) {
    return fetchWithCache(request, cacheControl);
  }

  // Handle OAuth callback
  if (request.url.includes("/oauth/callback")) {
    const authCode = url.searchParams.get("code");

    if (authCode) {
      const tokens = await exchangeAuthCodeForTokens(
        authCode,
        oauthCredentials,
      );
      const jwtToken = await createJwtToken(tokens, oauthCredentials);
      const response = redirectTo("/author-tools");
      return setCookie(response, "jwt", jwtToken);
    }
  }

  // Allow all non-protected routes
  if (!request.url.includes("/author-tools")) {
    return fetchWithCache(request, cacheControl);
  }

  // ============================================
  // PROTECT /author-tools WITH JWT
  // ============================================

  const cookies = parseCookies(request.headers.get("cookie") || "");
  const jwtToken = cookies["jwt"];

  if (jwtToken) {
    try {
      const verified = await jwt.verify(
        jwtToken,
        oauthCredentials.OAUTH_CLIENT_SECRET,
      );

      if (verified) {
        return fetchWithCache(request, cacheControl);
      }
    } catch (err) {
      console.log("JWT error:", err);
      return redirectToLogin();
    }
  }

  return redirectToLogin();
}

// =====================
// HELPER FUNCTIONS
// =====================

function getUnauthorizedResponse(message) {
  const response = new Response(message, {
    status: 401,
  });
  response.headers.set(
    "WWW-Authenticate",
    'Basic realm="Contentstack Launch Protected Area"',
  );
  return response;
}

function parseCredentials(authorization) {
  const [, base64Credentials] = authorization.split(" ");
  const decoded = atob(base64Credentials);
  const [inputUsername, inputPassword] = decoded.split(":");
  return [inputUsername, inputPassword];
}

function handlePasswordProtection(request, passwordProtection) {
  const authorization = request.headers.get("authorization");

  if (!authorization) {
    return getUnauthorizedResponse(
      "Provide Username and Password to access this page.",
    );
  }

  try {
    const [inputUsername, inputPassword] = parseCredentials(authorization);

    if (
      inputUsername !== passwordProtection.username ||
      inputPassword !== passwordProtection.password
    ) {
      return getUnauthorizedResponse(
        "The Username and Password combination you have entered is invalid.",
      );
    }

    return null; // Authentication successful
  } catch (error) {
    console.error("[AUTH] Error parsing credentials:", error);
    return getUnauthorizedResponse("Invalid authentication format.");
  }
}

async function fetchWithCache(request, cacheControl, cfFetchOptions, cacheSanitize) {
  const response = cfFetchOptions
    ? await fetch(request, { cf: cfFetchOptions })
    : await fetch(request);

  if (!cacheControl) return response;

  const modified = new Response(response.body, response);
  if (cacheSanitize?.stripSetCookie) {
    modified.headers.delete("Set-Cookie");
  }
  modified.headers.set("Cache-Control", cacheControl);
  modified.headers.set("CDN-Cache-Control", cacheControl);
  return modified;
}

function parseCookies(cookieString) {
  return cookieString.split(";").reduce((acc, cookie) => {
    const [key, value] = cookie.split("=").map((c) => c.trim());
    acc[key] = value;
    return acc;
  }, {});
}

function setCookie(response, name, value) {
  const modified = new Response(response.body, response);
  modified.headers.set("Set-Cookie", `${name}=${value}; Path=/; HttpOnly`);
  return modified;
}

function redirectToLogin() {
  return redirectTo("/login");
}

function timeNow() {
  return Math.floor(Date.now() / 1000);
}

function redirectTo(path) {
  return new Response(null, {
    status: 307,
    headers: { Location: path },
  });
}

async function exchangeAuthCodeForTokens(authCode, creds) {
  const res = await fetch(creds.OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: creds.OAUTH_CLIENT_ID,
      client_secret: creds.OAUTH_CLIENT_SECRET,
      code: authCode,
      redirect_uri: creds.OAUTH_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data);
  return data;
}

async function createJwtToken(
  { access_token, refresh_token, expires_in },
  creds,
) {
  const exp = timeNow() + expires_in;
  return jwt.sign(
    { accessToken: access_token, refreshToken: refresh_token, exp },
    creds.OAUTH_CLIENT_SECRET,
  );
}
