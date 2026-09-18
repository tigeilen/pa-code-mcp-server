import * as dotenv from 'dotenv';
dotenv.config();

function bool(v: string | undefined, dflt: boolean): boolean {
    if (v == null || v === '') return dflt;
    return /^(1|true|yes|on)$/i.test(v.trim());
}
function num(v: string | undefined, dflt: number): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : dflt;
}

export type AuthMode = 'basic' | 'cam' | 'apikey';
export type McpMode = 'readonly' | 'readwrite';

export interface Tm1Config {
    baseUrl: string;
    authMode: AuthMode;
    user: string;
    password: string;
    camNamespace: string;
    rejectUnauthorized: boolean;
    timeoutMs: number;
}

export interface AppConfig {
    tm1: Tm1Config;
    mcpMode: McpMode;
    http: { port: number; token: string };
}

export function loadConfig(): AppConfig {
    const authMode = (process.env.TM1_AUTH_MODE || 'basic').toLowerCase() as AuthMode;
    return {
        tm1: {
            baseUrl: (process.env.TM1_BASE_URL || '').replace(/\/+$/, ''),
            authMode: ['basic', 'cam', 'apikey'].includes(authMode) ? authMode : 'basic',
            user: process.env.TM1_USER || '',
            password: process.env.TM1_PASSWORD || '',
            camNamespace: process.env.TM1_CAM_NAMESPACE || '',
            rejectUnauthorized: bool(process.env.TM1_SSL_REJECT_UNAUTHORIZED, false),
            timeoutMs: num(process.env.TM1_TIMEOUT_MS, 60000)
        },
        mcpMode: (process.env.MCP_MODE || 'readonly').toLowerCase() === 'readwrite' ? 'readwrite' : 'readonly',
        http: { port: num(process.env.MCP_HTTP_PORT, 3900), token: process.env.MCP_HTTP_TOKEN || '' }
    };
}
