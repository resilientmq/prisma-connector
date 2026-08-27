import {defineConfig} from 'prisma/config';

export default defineConfig({
    schema: './schema.prisma',
    datasource: {
        url: process.env.DATABASE_URL ?? 'mysql://root:root@localhost:3306/resilientmq'
    }
});
