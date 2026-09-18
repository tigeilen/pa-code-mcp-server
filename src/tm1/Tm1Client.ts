import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import { Tm1Config } from '../config.js';

/**
 * Minimal standalone TM1 / Planning Analytics REST client.
 *
 * Handles Basic / CAM / API-key authentication, keeps the TM1 session cookie,
 * and exposes generic get/post/patch/delete helpers plus a couple of convenience
 * builders. All higher-level model operations live in readApi.ts / writeApi.ts
 * and use these primitives, so this file stays small.
 */
export class Tm1Client {
    private http: AxiosInstance;
    private cookie = '';
    private connected = false;

    constructor(private cfg: Tm1Config) {
        this.http = axios.create({
            baseURL: cfg.baseUrl || undefined,
            timeout: cfg.timeoutMs,
            httpsAgent: new https.Agent({ rejectUnauthorized: cfg.rejectUnauthorized }),
            // TM1 returns 200 with an OData error body for many failures; let callers inspect.
            validateStatus: (s) => s >= 200 && s < 500
        });
    }

    /** Builds the Authorization header for the configured auth mode. */
    private authHeader(): string {
        if (this.cfg.authMode === 'apikey') {
            return 'Basic ' + Buffer.from(`apikey:${this.cfg.password}`).toString('base64');
        }
        if (this.cfg.authMode === 'cam' && this.cfg.camNamespace) {
            // TM1 CAM basic-auth form: base64(user:password:namespace)
            return 'Basic ' + Buffer.from(`${this.cfg.user}:${this.cfg.password}:${this.cfg.camNamespace}`).toString('base64');
        }
        return 'Basic ' + Buffer.from(`${this.cfg.user}:${this.cfg.password}`).toString('base64');
    }

    private headers(): Record<string, string> {
        const h: Record<string, string> = {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        };
        if (this.cookie) h['Cookie'] = this.cookie;
        else h['Authorization'] = this.authHeader();
        return h;
    }

    private captureCookie(resp: any): void {
        const set = resp?.headers?.['set-cookie'];
        if (Array.isArray(set) && set.length) {
            const tm1 = set.map((c: string) => c.split(';')[0]).filter((c: string) => /TM1SessionId|paSession|ba-sso/i.test(c));
            if (tm1.length) this.cookie = tm1.join('; ');
        }
    }

    private fail(resp: any, action: string): never {
        const msg = resp?.data?.error?.message || resp?.statusText || `HTTP ${resp?.status}`;
        throw new Error(`${action} failed: ${msg}`);
    }

    /** Authenticates against /Configuration and stores the session cookie. */
    async connect(): Promise<void> {
        if (this.connected) return;
        if (!this.cfg.baseUrl) throw new Error('TM1_BASE_URL is not set — configure the MCP server .env.');
        const resp = await this.http.get('/api/v1/Configuration', { headers: this.headers() });
        if (resp.status === 401 || resp.status === 403) this.fail(resp, 'Authentication');
        if (resp.status >= 400) this.fail(resp, 'Connect');
        this.captureCookie(resp);
        this.connected = true;
    }

    async get(path: string): Promise<any> {
        await this.connect();
        const resp = await this.http.get(path, { headers: this.headers() });
        this.captureCookie(resp);
        if (resp.status >= 400) this.fail(resp, `GET ${path}`);
        return resp.data;
    }

    async post(path: string, body: any): Promise<any> {
        await this.connect();
        const resp = await this.http.post(path, body, { headers: this.headers() });
        this.captureCookie(resp);
        if (resp.status >= 400) this.fail(resp, `POST ${path}`);
        return resp.data;
    }

    async patch(path: string, body: any): Promise<any> {
        await this.connect();
        const resp = await this.http.patch(path, body, { headers: this.headers() });
        this.captureCookie(resp);
        if (resp.status >= 400) this.fail(resp, `PATCH ${path}`);
        return resp.data;
    }

    async del(path: string): Promise<void> {
        await this.connect();
        const resp = await this.http.delete(path, { headers: this.headers() });
        this.captureCookie(resp);
        if (resp.status >= 400) this.fail(resp, `DELETE ${path}`);
    }
}

/** Escapes a value for use inside an OData single-quoted key. */
export function odataKey(s: string): string {
    return encodeURIComponent(s).replace(/'/g, "''");
}
