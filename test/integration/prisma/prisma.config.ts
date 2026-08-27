import {defineConfig} from 'prisma/config';

export default defineConfig({
    schema: './schema.prisma',
    datasource: {
        url: 'file:./test/integration/prisma/test.db'
    }
});
