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
            reporter: ['text', 'json-summary', 'lcov'],
            include: ['src/**/*.ts'],
            thresholds: {
                lines: 90,
                functions: 90,
                statements: 90,
                branches: 80
            }
        }
    }
});
