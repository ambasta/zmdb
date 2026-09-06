import type { ToolSchema } from '@zmdb/ai';
import { jsonSchema, tool } from 'ai';

import { aiSdkTool } from './index.js';

interface EchoInput {
  readonly value: string;
}

function realAiSdkContracts(schema: ToolSchema): void {
  const validate = (value: unknown): EchoInput => ({ value: String(Reflect.get(Object(value), 'value')) });
  const execute = (input: EchoInput): string => input.value;

  const supported = tool(
    aiSdkTool('echo', schema, {
      jsonSchema,
      description: 'Echo one value',
      validate,
      execute,
    }),
  );

  void supported;
}

void realAiSdkContracts;
