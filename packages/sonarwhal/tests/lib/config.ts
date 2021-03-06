import * as path from 'path';

import test from 'ava';
import * as sinon from 'sinon';
import * as proxyquire from 'proxyquire';

import { ConnectorConfig, CLIOptions, IRule, RuleMetadata, UserConfig } from '../../src/lib/types';
import { RuleScope } from '../../src/lib/enums/rulescope';
import { readFileAsync } from '../../src/lib/utils/misc';

test.beforeEach((t) => {
    delete require.cache[require.resolve('os')];
    delete require.cache[require.resolve('../../src/lib/config')];

    const os = require('os');
    const resourceLoader = {
        loadConfiguration() { },
        loadRule() { }
    };

    proxyquire('../../src/lib/config', {
        './utils/resource-loader': resourceLoader,
        os
    });

    t.context.config = require('../../src/lib/config');
    t.context.os = os;
    t.context.resourceLoader = resourceLoader;
    t.context.sandbox = sinon.createSandbox();
});

test.afterEach((t) => {
    t.context.sandbox.restore();
});

test('if there is no configuration file anywhere, it should call os.homedir and return null', (t) => {
    const dir = path.resolve('./fixtures/getFileNameForDirectoryEmpty');
    const { config, os, sandbox } = t.context;

    // We return the same dir so it doesn't look in the users homedir
    const stub = (sandbox as sinon.SinonSandbox)
        .stub(os, 'homedir')
        .onCall(4) // shell.test uses os.homedir each time, and we have 4 CONFIG_FILES before
        .returns(dir);

    const result = config.SonarwhalConfig.getFilenameForDirectory(dir);

    t.is(result, null);
    t.is(stub.callCount, 5, `os.homedir() wasn't called to get the users homedir`);
});

test('if there is configuration file, it should return the path to the file', (t) => {
    const { config } = t.context;
    const result = config.SonarwhalConfig.getFilenameForDirectory(path.join(__dirname, './fixtures/getFilenameForDirectory'));

    t.true(result.includes('.sonarwhalrc'));
});

test('if SonarwhalConfig.fromFilePath is called with a non valid file extension, it should return an exception', (t) => {
    const { config } = t.context;
    const error = t.throws(() => {
        config.SonarwhalConfig.fromFilePath(path.join(__dirname, './fixtures/notvalid/notvalid.css'), null);
    });

    t.is(error.message, `Couldn't find a configuration file`);
});

test(`if package.json doesn't have a sonarwhal configuration, it should return an exception`, (t) => {
    const { config } = t.context;
    const error = t.throws(() => {
        config.SonarwhalConfig.fromFilePath(path.join(__dirname, './fixtures/notvalid/package.json'), null);
    });

    t.is(error.message, `Couldn't find a configuration file`);
});

test(`if package.json is an invalid JSON, it should return an exception`, (t) => {
    const { config } = t.context;
    const error = t.throws(() => {
        config.SonarwhalConfig.fromFilePath(path.join(__dirname, './fixtures/exception/package.json'), null);
    });

    t.true(error.message.startsWith('Cannot read config file: '));
});

test(`if the config file doesn't have an extension, it should be parsed as JSON file`, (t) => {
    const { config, resourceLoader, sandbox } = t.context;

    class FakeDisallowedRule implements IRule {
        public static called: boolean = false;
        private context;
        public constructor(context) {
            FakeDisallowedRule.called = true;
            this.context = context;
        }

        public static readonly meta: RuleMetadata = {
            id: 'disallowed-headers',
            schema: [],
            scope: RuleScope.any
        }
    }

    sandbox.stub(resourceLoader, 'loadRule').returns(FakeDisallowedRule);

    const configuration = config.SonarwhalConfig.fromFilePath(path.join(__dirname, './fixtures/valid/sonarwhalrc'), { watch: false } as CLIOptions);

    t.is((configuration.connector as ConnectorConfig).name, 'chrome');
    t.is(configuration.rules['disallowed-headers'], 'warning');
});

test(`if the config file is JavaScript, it should return the configuration part`, (t) => {
    const { config, resourceLoader, sandbox } = t.context;

    class FakeDisallowedRule implements IRule {
        public static called: boolean = false;
        private context;
        public constructor(context) {
            FakeDisallowedRule.called = true;
            this.context = context;
        }

        public static readonly meta: RuleMetadata = {
            id: 'disallowed-headers',
            schema: [],
            scope: RuleScope.any
        }
    }

    sandbox.stub(resourceLoader, 'loadRule').returns(FakeDisallowedRule);

    const configuration = config.SonarwhalConfig.fromFilePath(path.join(__dirname, './fixtures/valid/sonarwhalrc.js'), { watch: true } as CLIOptions);

    t.is((configuration.connector as ConnectorConfig).name, 'chrome');
    t.is(configuration.rules['disallowed-headers'], 'warning');
});

test(`if package.json contains a valid sonarwhal configuration, it should return it`, (t) => {
    const { config, resourceLoader, sandbox } = t.context;

    class FakeDisallowedRule implements IRule {
        public static called: boolean = false;
        private context;
        public constructor(context) {
            FakeDisallowedRule.called = true;
            this.context = context;
        }

        public static readonly meta: RuleMetadata = {
            id: 'disallowed-headers',
            schema: [],
            scope: RuleScope.any
        }
    }

    sandbox.stub(resourceLoader, 'loadRule').returns(FakeDisallowedRule);

    const configuration = config.SonarwhalConfig.fromFilePath(path.join(__dirname, './fixtures/valid/package.json'), { watch: false } as CLIOptions);

    t.is((configuration.connector as ConnectorConfig).name, 'chrome');
    t.is(configuration.rules['disallowed-headers'][0], 'warning');
});

test(`if package.json contains the property "ignoredUrls", it shold return them`, (t) => {
    const { config, resourceLoader, sandbox } = t.context;

    class FakeDisallowedRule implements IRule {
        public static called: boolean = false;
        private context;
        public constructor(context) {
            FakeDisallowedRule.called = true;
            this.context = context;
        }

        public static readonly meta: RuleMetadata = {
            id: 'disallowed-headers',
            schema: [],
            scope: RuleScope.any
        }
    }

    sandbox.stub(resourceLoader, 'loadRule').returns(FakeDisallowedRule);

    const configuration = config.SonarwhalConfig.fromFilePath(path.join(__dirname, './fixtures/valid/package.json'), { watch: false } as CLIOptions);

    t.is((configuration.connector as ConnectorConfig).name, 'chrome');
    t.is(configuration.ignoredUrls.size, 2);
    t.is(configuration.ignoredUrls.get('all').length, 2);
    t.is(configuration.ignoredUrls.get('disallowed-headers').length, 1);
});

test(`if the configuration file contains an extends property, it should combine the configurations`, async (t) => {
    const { config, resourceLoader, sandbox } = t.context;

    class FakeDisallowedRule implements IRule {
        public static called: boolean = false;
        private context;
        public constructor(context) {
            FakeDisallowedRule.called = true;
            this.context = context;
        }

        public static readonly meta: RuleMetadata = {
            id: 'disallowed-headers',
            schema: [],
            scope: RuleScope.any
        }
    }

    sandbox.stub(resourceLoader, 'loadRule').returns(FakeDisallowedRule);

    const exts = JSON.parse(await readFileAsync(path.join(__dirname, './fixtures/valid/package.json'))).sonarwhalConfig;

    sandbox.stub(resourceLoader, 'loadConfiguration').returns(exts);

    const configuration = config.SonarwhalConfig.fromFilePath(path.join(__dirname, './fixtures/valid/withextends.json'), { watch: false } as CLIOptions);

    t.is((configuration.connector as ConnectorConfig).name, 'chrome');
    t.is(configuration.rules['disallowed-headers'], 'error');
});


test(`if the configuration file contains an invalid extends property, returns an exception`, async (t) => {
    const { config, resourceLoader, sandbox } = t.context;
    const exts = JSON.parse(await readFileAsync(path.join(__dirname, './fixtures/notvalid/package.json'))).sonarwhalConfig;

    sandbox.stub(resourceLoader, 'loadConfiguration').returns(exts);

    const err = t.throws(() => {
        config.SonarwhalConfig.fromFilePath(path.join(__dirname, './fixtures/valid/withextends.json'), { watch: false } as CLIOptions);
    });

    t.is(err.message, 'Configuration package "basics" is not valid');

});

test(`if a Rule has an invalid configuration, it should tell which ones are invalid`, (t) => {
    const { config, resourceLoader, sandbox } = t.context;

    class FakeDisallowedRule implements IRule {
        public static called: boolean = false;
        private context;
        public constructor(context) {
            FakeDisallowedRule.called = true;
            this.context = context;
        }

        public static readonly meta: RuleMetadata = {
            id: 'disallowed-headers',
            schema: [{
                additionalProperties: false,
                properties: {
                    testprop: {
                        description: 'Test property',
                        type: 'string'
                    }
                },
                required: [
                    'testprop'
                ]
            }],
            scope: RuleScope.any
        }
    }

    sandbox.stub(resourceLoader, 'loadRule').returns(FakeDisallowedRule);

    const configuration = config.SonarwhalConfig.fromFilePath(path.join(__dirname, './fixtures/valid/package.json'), { watch: false } as CLIOptions);
    const { invalid } = config.SonarwhalConfig.validateRulesConfig(configuration);

    t.is(invalid.length, 1);
});

test('If formatter is specified as CLI argument, fromConfig method will use that to build SonarwhalConfig', (t) => {
    const { config } = t.context;
    const userConfig = {
        connector: { name: 'chrome' },
        formatters: ['summary', 'excel'],
        rules: { 'apple-touch-icons': 'warning' }
    } as UserConfig;
    const cliOptions = { _: ['https://example.com'], formatters: 'database' } as CLIOptions;

    const result = config.SonarwhalConfig.fromConfig(userConfig, cliOptions);

    t.is(result.formatters.length, 1);
    t.is(result.formatters[0], 'database');
    // Make sure we updated only the formatters. Other properties of userConfig should stay same
    t.is(result.connector.name, 'chrome');
});

test('If formatter is not specified as CLI argument, fromConfig method will use the formatter specified in the userConfig object as it is to build SonarwhalConfig', (t) => {
    const { config } = t.context;
    const userConfig = {
        connector: { name: 'chrome' },
        formatters: ['summary', 'excel'],
        rules: { 'apple-touch-icons': 'warning' }
    } as UserConfig;
    const cliOptions = { _: ['https://example.com'] } as CLIOptions;

    const result = config.SonarwhalConfig.fromConfig(userConfig, cliOptions);

    t.is(result.formatters.length, 2);
    t.is(result.formatters[0], 'summary');
    t.is(result.formatters[1], 'excel');
});
