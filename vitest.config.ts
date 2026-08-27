import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        exclude: [
            'node_modules/**',
            'dist/**',
            'test/integration/**',
            'test/compatibility/**'
        ],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json-summary'],
            include: ['src/**/*.ts'],
            thresholds: {
                lines: 80,
                functions: 80,
                statements: 80,
                branches: 70
            }
        }
    }
});
