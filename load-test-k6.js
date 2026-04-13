import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const etimedoutCounter = new Counter('etimedout_errors');
const failedRequests = new Counter('failed_requests');

export const options = {
  scenarios: {
    spike_load: {
      executor: 'constant-arrival-rate',
      rate: 300,              // 300 requests per second (very aggressive)
      timeUnit: '1s',
      duration: '10s',        // 10 seconds = 3000 total requests
      preAllocatedVUs: 400,
      maxVUs: 600,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.5'],
  },
};

const TARGET_URL = __ENV.TARGET_URL || 'http://localhost:3000/api/cda-call';

export default function () {
  const response = http.get(TARGET_URL, {
    timeout: '3s',  // Short timeout to trigger ETIMEDOUT
  });
  
  check(response, {
    'is success': (r) => r.status === 200,
  });
  
  if (response.error) {
    failedRequests.add(1);
    const errorStr = String(response.error);
    
    if (errorStr.includes('timeout') || errorStr.includes('ETIMEDOUT')) {
      etimedoutCounter.add(1);
      console.log(`🎯 TIMEOUT: ${response.error}`);
    } else {
      console.log(`❌ ${response.error}`);
    }
  }
}
