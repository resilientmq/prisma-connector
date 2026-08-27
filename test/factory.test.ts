import {createPrismaEventStores} from '../src/index.js';
import {MemoryPrismaDelegate} from './support/memory-delegate.js';

describe('createPrismaEventStores', () => {
    it('resolves default and custom delegate names', () => {
        const inbox = new MemoryPrismaDelegate();
        const outbox = new MemoryPrismaDelegate();
        expect(createPrismaEventStores({
            client: {customInbox: inbox, customOutbox: outbox},
            namespace: 'service',
            models: {inbox: 'customInbox', outbox: 'customOutbox'}
        })).toMatchObject({consumer: expect.anything(), publisher: expect.anything()});
    });

    it('rejects an empty namespace or missing model delegate', () => {
        expect(() => createPrismaEventStores({client: {}, namespace: ' '})).toThrow(/namespace/);
        expect(() => createPrismaEventStores({client: {}, namespace: 'service'})).toThrow(/resilientMqInboxEvent/);
    });
});
