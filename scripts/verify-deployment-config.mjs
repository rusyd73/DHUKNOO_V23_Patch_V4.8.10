import fs from 'node:fs';

const required = ['docker-compose.yml', 'backend/Dockerfile', 'frontend/Dockerfile', 'frontend/nginx.conf', '.dockerignore'];
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`FAIL missing deployment file: ${file}`);
}

const compose = fs.readFileSync('docker-compose.yml', 'utf8');
const nginx = fs.readFileSync('frontend/nginx.conf', 'utf8');
const dockerignore = fs.readFileSync('.dockerignore', 'utf8');
const checks = [
  ['canonical compose has no local postgres', !/^\s{2}postgres:/m.test(compose)],
  ['backend uses backend/.env', compose.includes('./backend/.env')],
  ['payout defaults to manual', compose.includes('PAYOUT_MODE: MANUAL')],
  ['only frontend binds localhost port 8080', compose.includes('127.0.0.1:8080:80')],
  ['nginx proxies API', nginx.includes('location /api/') && nginx.includes('http://backend:3000')],
  ['nginx proxies WebSocket', nginx.includes('location /socket.io/') && nginx.includes('proxy_set_header Upgrade')],
  ['nginx proxies uploads', nginx.includes('location /uploads/')],
  ['secrets excluded from Docker context', dockerignore.includes('**/.env')],
  ['git excluded from Docker context', dockerignore.includes('.git')],
];

for (const [label, passed] of checks) {
  if (!passed) throw new Error(`FAIL - ${label}`);
  console.log(`PASS - ${label}`);
}
