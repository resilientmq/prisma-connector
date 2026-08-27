export {
    RESILIENTMQ_MODEL_NAMES,
    RESILIENTMQ_METRICS_MODEL_NAME,
    RESILIENTMQ_PRISMA_MODELS,
    getResilientMqPrismaModel,
    getResilientMqPrismaModels,
    type ResilientMqPrismaSchemaOptions,
    type ResilientMqPrismaTableNames,
    type SupportedPrismaProvider
} from './templates.js';
export {
    PrismaSchemaManager,
    preparePrismaSchemaUpdate,
    resolvePrismaSchemaPath,
    updatePrismaSchema,
    type PrismaSchemaUpdate,
    type PrismaSchemaInstallOptions,
    type ResolvePrismaSchemaOptions
} from './update-schema.js';
