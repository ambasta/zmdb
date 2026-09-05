import type { ToolSchema } from '@zmdb/ai';
import { jsonSchema as currentJsonSchema, tool as currentTool } from 'ai';
import { jsonSchema as lowerJsonSchema, tool as lowerTool } from 'ai-lower-bound';

import { aiSdkTool } from './index.js';

interface EchoInput {
  readonly value: string;
}

function realAiSdkContracts(schema: ToolSchema): void {
  const validate = (value: unknown): EchoInput => ({ value: String(Reflect.get(Object(value), 'value')) });
  const execute = (input: EchoInput): string => input.value;

  const current = currentTool(
    aiSdkTool('echo', schema, {
      jsonSchema: currentJsonSchema,
      description: 'Echo one value',
      validate,
      execute,
    }),
  );
  const lowerBound = lowerTool(
    aiSdkTool('echo', schema, {
      jsonSchema: lowerJsonSchema,
      description: 'Echo one value',
      validate,
      execute,
    }),
  );

  void current;
  void lowerBound;
}

void realAiSdkContracts;
