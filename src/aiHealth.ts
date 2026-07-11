export class AIGlobalHealth {
    private aiServices = [
        { name: 'thinking_brain', url: 'http://localhost:8000/health', checkType: 'http200' },
        { name: 'speaking_lips', url: 'http://localhost:8003/health', checkType: 'http200' },
        { name: 'listening_ears', url: 'http://localhost:8004/health', checkType: 'jsonStatusOk' }
    ];

    private snapshot: Record<string, { healthy: boolean; error?: string }> = {};

    async updateHealth() {
        this.snapshot = await Promise.all(this.aiServices.map(async svc => {
            try {
                const res = await fetch(svc.url, { timeout: 3000 });
                if (svc.checkType === 'http200') {
                    return [svc.name, { healthy: res.status === 200 }];
                } else {
                    const json = await res.json();
                    return [svc.name, { healthy: json.status === 'ok' }];
                }
            } catch (e: any) {
                return [svc.name, { healthy: false, error: e.message }];
            }
        })).then(results => Object.fromEntries(results));
        return this.snapshot;
    }

    getHealth() {
        return this.snapshot;
    }
}
