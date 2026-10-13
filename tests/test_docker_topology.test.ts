import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('Phase 5 — Docker Topology & Container Specifications', () => {
  it('should verify all required containerization files exist', () => {
    const requiredFiles = [
      'Dockerfile.gateway',
      'Dockerfile.client',
      'client/nginx.conf',
      'docker-compose.yml',
      '.dockerignore'
    ];

    for (const relPath of requiredFiles) {
      const fullPath = path.join(rootDir, relPath);
      expect(fs.existsSync(fullPath), `Missing required file: ${relPath}`).toBe(true);
      const stats = fs.statSync(fullPath);
      expect(stats.size).toBeGreaterThan(0);
    }
  });

  describe('Dockerfile.gateway', () => {
    const gatewayContent = fs.readFileSync(path.join(rootDir, 'Dockerfile.gateway'), 'utf-8');

    it('should be a multi-stage build based on node:22-alpine', () => {
      expect(gatewayContent).toMatch(/FROM node:22-alpine AS builder/i);
      expect(gatewayContent).toMatch(/FROM node:22-alpine AS runner/i);
    });

    it('should compile TypeScript in builder stage and run compiled JS in runner stage', () => {
      expect(gatewayContent).toContain('npx tsc');
      expect(gatewayContent).toMatch(/CMD \["node", "dist\/gateway\/index\.js"\]/);
    });

    it('should expose port 8080 and declare healthcheck with unprivileged user', () => {
      expect(gatewayContent).toContain('EXPOSE 8080');
      expect(gatewayContent).toMatch(/nc -z (127\.0\.0\.1|localhost) 8080/);
      expect(gatewayContent).toContain('USER node');
    });
  });

  describe('Dockerfile.client & client/nginx.conf', () => {
    const clientContent = fs.readFileSync(path.join(rootDir, 'Dockerfile.client'), 'utf-8');
    const nginxContent = fs.readFileSync(path.join(rootDir, 'client/nginx.conf'), 'utf-8');

    it('should compile Vite bundle in builder and deploy to nginx:alpine', () => {
      expect(clientContent).toMatch(/FROM node:22-alpine AS builder/i);
      expect(clientContent).toContain('npm run build');
      expect(clientContent).toMatch(/FROM nginx:alpine AS runner/i);
      expect(clientContent).toContain('/usr/share/nginx/html');
      expect(clientContent).toContain('EXPOSE 80');
    });

    it('should configure SPA fallback, gzip, and cache headers in nginx.conf', () => {
      expect(nginxContent).toContain('listen 80;');
      expect(nginxContent).toContain('gzip on;');
      expect(nginxContent).toContain('try_files $uri $uri/ /index.html;');
      expect(nginxContent).toContain('Cache-Control "public, max-age=31536000, immutable";');
    });
  });

  describe('docker-compose.yml', () => {
    const composeContent = fs.readFileSync(path.join(rootDir, 'docker-compose.yml'), 'utf-8');

    it('should define gateway and client services with correct port mappings', () => {
      expect(composeContent).toContain('gateway:');
      expect(composeContent).toContain('"8080:8080"');
      expect(composeContent).toContain('client:');
      expect(composeContent).toContain('"5173:80"');
    });

    it('should configure healthcheck dependency and bridge network', () => {
      expect(composeContent).toContain('condition: service_healthy');
      expect(composeContent).toContain('telemetry-net:');
      expect(composeContent).toContain('driver: bridge');
    });

    it('should pass environment variables to gateway service', () => {
      expect(composeContent).toContain('PORT=8080');
      expect(composeContent).toContain('SIMULATION_HZ=100');
      expect(composeContent).toContain('BROADCAST_HZ=60');
      expect(composeContent).toContain('DEADBAND=0.001');
    });
  });

  describe('.dockerignore', () => {
    const ignoreContent = fs.readFileSync(path.join(rootDir, '.dockerignore'), 'utf-8');

    it('should exclude node_modules, build outputs, and VCS metadata', () => {
      expect(ignoreContent).toContain('node_modules');
      expect(ignoreContent).toContain('dist');
      expect(ignoreContent).toContain('.git');
      expect(ignoreContent).toContain('.gemini');
    });
  });
});
