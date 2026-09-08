import type { IncomingMessage, ServerResponse } from 'node:http';

export function handleExport(request: IncomingMessage, response: ServerResponse): Promise<void>;
