import {readFile} from 'node:fs/promises';
import pg from 'pg';
import mariadb from 'mariadb';

const provider = process.env.TEST_DATABASE_PROVIDER;
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

if (provider === 'postgresql') {
    const sql = await readFile('test/integration/postgresql/init.sql', 'utf8');
    const client = new pg.Client({connectionString: url});
    await client.connect();
    try {
        await client.query(sql);
    } finally {
        await client.end();
    }
} else if (provider === 'mysql') {
    const sql = await readFile('test/integration/mysql/init.sql', 'utf8');
    const connection = await mariadb.createConnection({...parseMariaDbUrl(url), multipleStatements: true});
    try {
        await connection.query(sql);
    } finally {
        await connection.end();
    }
} else {
    throw new Error(`Unsupported TEST_DATABASE_PROVIDER: ${provider ?? 'undefined'}`);
}

function parseMariaDbUrl(value) {
    const parsed = new URL(value);
    return {
        host: parsed.hostname,
        port: Number(parsed.port || 3306),
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        database: parsed.pathname.slice(1)
    };
}
