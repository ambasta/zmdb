// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { commandTemplate } from './command.js';
import { controllerTemplate } from './controller.js';
import { moduleTemplate } from './module.js';
import { projectTemplate } from './project.js';
import { repositoryTemplate } from './repository.js';
import { schemaTemplate } from './schema.js';
import type { ScaffoldKind, TemplateFactory } from './types.js';

const TEMPLATES: Readonly<Record<ScaffoldKind, TemplateFactory>> = {
  command: commandTemplate,
  controller: controllerTemplate,
  module: moduleTemplate,
  project: projectTemplate,
  repository: repositoryTemplate,
  schema: schemaTemplate,
};

export function templateFor(kind: ScaffoldKind): TemplateFactory {
  return TEMPLATES[kind];
}

export type {
  ScaffoldKind,
  ScaffoldName,
  TemplateContext,
  TemplateFactory,
  TemplateFile,
  TemplatePlan,
} from './types.js';
