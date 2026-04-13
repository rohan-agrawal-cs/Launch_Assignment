import { NextResponse } from "next/server";

let requestCounter = 0;

export async function GET() {
  requestCounter++;
  const reqId = requestCounter;
  
  // Sample Contentstack asset URL - replace with actual asset UID if needed
  const assetUrl = `https://images.contentstack.io/v3/assets/bltd932e43f7244d14c/blt4d63bba14a3eb134/logo.png`;

  const promises = Array.from({ length: 10 }, async (_, i) => {
    try {
      const response = await fetch(assetUrl, {
        headers: {
          api_key: process.env.CONTENTSTACK_API_KEY || "",
          access_token: process.env.CONTENTSTACK_DELIVERY_TOKEN || "",
        },
      });
      
      console.log(`[ASSET-${reqId}.${i + 1}] ✅ ${response.status}`);
      return { status: response.status };
      
    } catch (err) {
      const error = err as { code?: string; message?: string };
      console.log(`[ASSET-${reqId}.${i + 1}] ❌ ${error?.code}: ${error?.message}`);
      
      if (error?.code === 'ETIMEDOUT') {
        console.log(`[ASSET-${reqId}.${i + 1}] 🎯 ETIMEDOUT ERROR!`);
      }
      
      return null;
    }
  });

  const results = await Promise.allSettled(promises);
  
  return NextResponse.json({ results });
}
