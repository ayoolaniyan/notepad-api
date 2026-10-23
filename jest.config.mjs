// One Jest project per package. Integration projects need PostgreSQL (see README "Testing");
// unit projects run without any services.

/** @type {import("jest").Config} */
const base = {
    testEnvironment: "node",
    transform: {
        // SWC only strips types; `npm run typecheck` does the type checking
        "^.+\\.ts$": ["@swc/jest", { jsc: { parser: { syntax: "typescript" }, target: "es2022" } }],
    },
    moduleNameMapper: {
        // Run services against shared's source, so tests don't depend on a fresh build of dist/
        "^@notepad/shared$": "<rootDir>/../../shared/src/index.ts",
        // The generated Prisma clients import "./x.js" from TypeScript sources
        "^(\\.{1,2}/.*)\\.js$": "$1",
    },
    restoreMocks: true,
};

/** @param {string} name @param {Partial<import("jest").Config>} options */
const service = (name, options) => ({
    ...base,
    rootDir: `services/${name}`,
    setupFiles: ["<rootDir>/test/setup-env.ts"],
    ...options,
});

/** @type {import("jest").Config} */
export default {
    // On a cold run (every CI job) the first test to load an app also pays for compiling its
    // whole dependency graph, which can exceed Jest's 5s default. A global option: Jest
    // ignores it inside projects.
    testTimeout: 15_000,
    projects: [
        { ...base, displayName: "shared", rootDir: "shared", testMatch: ["<rootDir>/src/**/*.test.ts"] },
        service("api-gateway", {
            displayName: "api-gateway",
            testMatch: ["<rootDir>/{src,test}/**/*.test.ts"],
            // http-proxy-middleware and two of its dependencies are ESM-only. Node 22 can require()
            // them at runtime, but Jest can't before Node 24.9, so compile them to CommonJS for tests.
            transform: {
                ...base.transform,
                "^.+\\.m?js$": ["@swc/jest", { jsc: { parser: { syntax: "ecmascript" }, target: "es2022" } }],
            },
            transformIgnorePatterns: ["/node_modules/(?!(http-proxy-middleware|httpxy|is-plain-obj)/)"],
        }),
        service("auth-service", { displayName: "auth-service", testMatch: ["<rootDir>/src/**/*.test.ts"] }),
        service("notes-service", { displayName: "notes-service", testMatch: ["<rootDir>/src/**/*.test.ts"] }),
        service("auth-service", {
            displayName: "auth-service:integration",
            testMatch: ["<rootDir>/test/**/*.int.test.ts"],
            globalSetup: "<rootDir>/test/global-setup.ts",
        }),
        service("notes-service", {
            displayName: "notes-service:integration",
            testMatch: ["<rootDir>/test/**/*.int.test.ts"],
            globalSetup: "<rootDir>/test/global-setup.ts",
        }),
    ],
    collectCoverageFrom: [
        "<rootDir>/shared/src/**/*.ts",
        "<rootDir>/services/*/src/**/*.ts",
        "!**/src/generated/**",
        "!**/src/index.ts",
        "!**/*.test.ts",
    ],
    // Applies to `npm run test:coverage` (the full suite); a little below current coverage
    coverageThreshold: {
        global: { statements: 85, branches: 80, functions: 85, lines: 85 },
    },
};
