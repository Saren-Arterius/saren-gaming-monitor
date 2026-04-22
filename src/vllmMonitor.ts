import { VLLMMetrics } from './types';
import { CONFIG } from './config';

export class VLLMMonitor {
    private lastStats: {
        prefillTokens: number;
        generationTokens: number;
        timestamp: number;
    } | null = null;

    private metrics: VLLMMetrics | null = null;
    private metricsUrl = CONFIG.vllm.metricsUrl;

    async updateMetrics(): Promise<VLLMMetrics | null> {
        try {
            const data = await this.collectData();
            this.metrics = this.transformMetrics(data);
        } catch (error) {
            console.error('Error updating vLLM metrics:', error);
        }
        return this.metrics;
    }

    getMetrics(): VLLMMetrics | null {
        return this.metrics;
    }

    async collectData(): Promise<string> {
        const response = await fetch(this.metricsUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch vLLM metrics: ${response.status} ${response.statusText}`);
        }
        return await response.text();
    }

    parseMetrics(text: string, requiredMetrics?: string[]): Record<string, { bracketContent: string, value: number }> {
        const metrics: Record<string, { bracketContent: string, value: number }> = {};
        const lines = text.split('\n');
        const needAll = !requiredMetrics;
        const needed = new Set(requiredMetrics || []);

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            const lastSpaceIdx = trimmed.lastIndexOf(' ');
            if (lastSpaceIdx === -1) continue;

            const metricPart = trimmed.substring(0, lastSpaceIdx);
            const valuePart = trimmed.substring(lastSpaceIdx + 1);

            const braceStartIdx = metricPart.indexOf('{');
            const braceEndIdx = metricPart.indexOf('}');

            let metricName: string;
            let bracketContent: string;

            if (braceStartIdx === -1) {
                metricName = metricPart;
                bracketContent = '';
            } else {
                metricName = metricPart.substring(0, braceStartIdx);
                bracketContent = metricPart.substring(braceStartIdx + 1, braceEndIdx);
            }

            if (needAll || needed.has(metricName)) {
                const value = Math.round(parseFloat(valuePart));
                if (metricName && !isNaN(value)) {
                    metrics[metricName] = { bracketContent, value };
                }
            }
        }

        return metrics;
    }

    transformMetrics(text: string): VLLMMetrics {
        const now = Date.now();
        const metrics = this.parseMetrics(text, [
            'vllm:prompt_tokens_total',
            'vllm:prompt_tokens_cached_total',
            'vllm:generation_tokens_total',
            'vllm:num_requests_running',
            'vllm:num_requests_waiting'
        ]);

        // Get cumulative token counts
        // Real prefill = prompt_tokens_total - prompt_tokens_cached_total (only actual GPU work)
        const promptTokensTotal = metrics['vllm:prompt_tokens_total']?.value || 0;
        const promptTokensCached = metrics['vllm:prompt_tokens_cached_total']?.value || 0;
        const prefillTokens = promptTokensTotal - promptTokensCached;
        const generationTokens = metrics['vllm:generation_tokens_total']?.value || 0;
        const numRequestsRunning = metrics['vllm:num_requests_running']?.value || 0;
        const numRequestsWaiting = metrics['vllm:num_requests_waiting']?.value || 0;

        // Calculate tokens per second
        let prefillTokensPerSecond = 0;
        let generationTokensPerSecond = 0;

        if (this.lastStats) {
            const timeDiff = (now - this.lastStats.timestamp) / 1000; // seconds
            if (timeDiff > 0) {
                const prefillDiff = prefillTokens - this.lastStats.prefillTokens;
                const generationDiff = generationTokens - this.lastStats.generationTokens;

                // Only update rates if values increased (reset detection)
                if (prefillDiff >= 0) {
                    prefillTokensPerSecond = Math.round(prefillDiff / timeDiff);
                }
                if (generationDiff >= 0) {
                    generationTokensPerSecond = Math.round(generationDiff / timeDiff);
                }
            }
        }

        // Update last stats
        this.lastStats = {
            prefillTokens,
            generationTokens,
            timestamp: now
        };

        let d = {
            prefillTokensPerSecond,
            generationTokensPerSecond,
            numRequestsRunning: Math.round(numRequestsRunning),
            numRequestsWaiting: Math.round(numRequestsWaiting),
            lastUpdate: now
        };
        return d;
    }
}

// Main function for direct execution
if (import.meta.main) {
    const monitor = new VLLMMonitor();

    console.log('Fetching vLLM metrics...');
    const raw1 = await monitor['collectData']();
    const parsed1 = monitor['parseMetrics'](raw1);
    console.log('First fetch:', {
        prefill: parsed1['vllm:request_prefill_kv_computed_tokens_sum']?.value,
        generation: parsed1['vllm:generation_tokens_total']?.value,
        running: parsed1['vllm:num_requests_running']?.value,
        waiting: parsed1['vllm:num_requests_waiting']?.value
    });

    await new Promise(r => setTimeout(r, 2000));

    const raw2 = await monitor['collectData']();
    const parsed2 = monitor['parseMetrics'](raw2);
    console.log('Second fetch:', {
        prefill: parsed2['vllm:request_prefill_kv_computed_tokens_sum']?.value,
        generation: parsed2['vllm:generation_tokens_total']?.value,
        running: parsed2['vllm:num_requests_running']?.value,
        waiting: parsed2['vllm:num_requests_waiting']?.value
    });

    const metrics = await monitor.updateMetrics();

    console.log('\n=== vLLM Metrics (after 2 seconds) ===');
    console.log(`Prefill Tokens/Second:     ${metrics?.prefillTokensPerSecond ?? 0}`);
    console.log(`Generation Tokens/Second:  ${metrics?.generationTokensPerSecond ?? 0}`);
    console.log(`Running Requests:          ${metrics?.numRequestsRunning ?? 0}`);
    console.log(`Waiting Requests:          ${metrics?.numRequestsWaiting ?? 0}`);
}
