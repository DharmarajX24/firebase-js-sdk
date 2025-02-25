/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as fs from 'fs';
import * as path from 'path';

import { Extractor, ExtractorConfig } from 'api-extractor-me';
import * as tmp from 'tmp';

import { addBlankLines, pruneDts, removeUnusedImports } from './prune-dts';
import * as yargs from 'yargs';

/* eslint-disable no-console */

// This script takes the output of the API Extractor, post-processes it using
// the pruned-dts script and then invokes API report to generate a report
// that only includes exported symbols. This is all done in temporary folders,
// all configuration is auto-generated for each run.

const baseApiExtractorConfigFile: string = path.resolve(
  __dirname,
  '../../config/api-extractor.json'
);
const reportFolder = path.resolve(__dirname, '../../common/api-review');
const tmpDir = tmp.dirSync().name;

function writeTypescriptConfig(packageRoot: string): void {
  const tsConfigJson = {
    extends: path.resolve(packageRoot, './tsconfig.json'),
    include: [path.resolve(packageRoot, './src')],
    compilerOptions: {
      downlevelIteration: true // Needed for FirebaseApp
    }
  };
  fs.writeFileSync(
    path.resolve(tmpDir, 'tsconfig.json'),
    JSON.stringify(tsConfigJson),
    { encoding: 'utf-8' }
  );
}

function writePackageJson(packageName: string): void {
  const packageJson = {
    'name': `@firebase/${packageName}`
  };
  const packageJsonPath = path.resolve(tmpDir, 'package.json');
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson), {
    encoding: 'utf-8'
  });
}

function loadApiExtractorConfig(
  packageName: string,
  typescriptDtsPath: string,
  rollupDtsPath: string,
  untrimmedRollupDtsPath: string,
  dtsRollupEnabled: boolean,
  apiReportEnabled: boolean
): ExtractorConfig {
  const apiExtractorJsonPath = path.resolve(tmpDir, 'api-extractor.json');
  const apiExtractorJson = {
    extends: baseApiExtractorConfigFile,
    mainEntryPointFilePath: typescriptDtsPath,
    'dtsRollup': {
      'enabled': dtsRollupEnabled,
      publicTrimmedFilePath: rollupDtsPath,
      untrimmedFilePath: untrimmedRollupDtsPath
    },
    'tsdocMetadata': {
      'enabled': false
    },
    'apiReport': {
      'enabled': apiReportEnabled,
      reportFileName: `${packageName}.api.md`,
      reportFolder
    },
    'messages': {
      'extractorMessageReporting': {
        'ae-missing-release-tag': {
          'logLevel': 'none'
        },
        'ae-unresolved-link': {
          'logLevel': 'none'
        },
        'ae-forgotten-export': {
          'logLevel': apiReportEnabled ? 'error' : 'none'
        }
      },
      'tsdocMessageReporting': {
        'tsdoc-undefined-tag': {
          'logLevel': 'none'
        }
      }
    }
  };
  fs.writeFileSync(apiExtractorJsonPath, JSON.stringify(apiExtractorJson), {
    encoding: 'utf-8'
  });
  console.log(apiExtractorJsonPath);
  return ExtractorConfig.loadFileAndPrepare(apiExtractorJsonPath);
}

/**
 * Generates the Public API from generated DTS files.
 *
 * @param packageName - The name of the Firebase package (e.g. "database" or
 * "firestore-lite")
 * @param packageRoot - The root path of the package
 * @param typescriptDtsPath - The .d.ts file generated by the Typescript
 * compiler as we transpile our sources
 * @param rollupDtsPath - A "bundled" version of our d.ts files that includes
 * all public and private types
 * @param untrimmedRollupDtsPath - A "bundled" version of our d.ts files that
 * includes all public and private types, but also include exports marked as
 * `@internal`. This file is used by compat APIs to use internal exports
 * @param publicDtsPath - The output file for the customer-facing .d.ts file
 * that only includes the public APIs
 */
export async function generateApi(
  packageName: string,
  packageRoot: string,
  typescriptDtsPath: string,
  rollupDtsPath: string,
  untrimmedRollupDtsPath: string,
  publicDtsPath: string
): Promise<void> {
  console.log(`Configuring API Extractor for #{packageName}`);
  writeTypescriptConfig(packageRoot);
  writePackageJson(packageName);

  let extractorConfig = loadApiExtractorConfig(
    packageName,
    typescriptDtsPath,
    rollupDtsPath,
    untrimmedRollupDtsPath,
    /* dtsRollupEnabled= */ true,
    /* apiReportEnabled= */ false
  );
  Extractor.invoke(extractorConfig, {
    localBuild: true
  });

  console.log('Generated rollup DTS');
  pruneDts(rollupDtsPath, publicDtsPath);
  console.log('Pruned DTS file');
  await addBlankLines(publicDtsPath);
  console.log('Added blank lines after imports');
  await removeUnusedImports(publicDtsPath);
  console.log('Removed unused imports');

  extractorConfig = loadApiExtractorConfig(
    packageName,
    publicDtsPath,
    rollupDtsPath,
    untrimmedRollupDtsPath,
    /* dtsRollupEnabled= */ false,
    /* apiReportEnabled= */ true
  );
  Extractor.invoke(extractorConfig, { localBuild: true });
  console.log(`API report for ${packageName} written to ${reportFolder}`);
}

const argv = yargs.options({
  package: {
    type: 'string',
    desc:
      'The name of the Firebase package (e.g. "database" or ' +
      '"firestore-lite")',
    require: true
  },
  packageRoot: {
    type: 'string',
    desc: 'The root path of the package',
    require: true
  },
  typescriptDts: {
    type: 'string',
    desc:
      'The .d.ts file generated by the Typescript compiler as we transpile ' +
      'our sources',
    require: true
  },
  rollupDts: {
    type: 'string',
    desc:
      'A "bundled" version of our d.ts files that include all public and ' +
      'private types',
    require: true
  },
  untrimmedRollupDts: {
    type: 'string',
    desc:
      ' A "bundled" version of our d.ts files that includes all public ' +
      'and private types, but also include exports marked as `@internal`. ' +
      'This file is used by compat APIs to use internal exports',
    require: true
  },
  publicDts: {
    type: 'string',
    desc:
      'The output file for the customer-facing .d.ts file that only ' +
      'includes the public APIs',
    require: true
  }
}).argv;

void generateApi(
  argv.package,
  path.resolve(argv.packageRoot),
  path.resolve(argv.typescriptDts),
  path.resolve(argv.rollupDts),
  path.resolve(argv.untrimmedRollupDts),
  path.resolve(argv.publicDts)
);
