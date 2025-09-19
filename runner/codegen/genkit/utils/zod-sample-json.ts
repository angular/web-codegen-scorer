import { z } from 'zod';

// A simple map to provide default values for primitive types
const DEFAULT_PRIMITIVE_VALS = {
  ZodString: 'string',
  ZodNumber: 123,
  ZodBoolean: true,
  ZodDate: new Date(),
  ZodNull: null,
  ZodAny: 'any',
  ZodUnknown: 'unknown',
  ZodNever: 'never',
  ZodVoid: undefined,
  ZodUndefined: undefined,
  ZodBigInt: BigInt(1),
};

export function generateZodSampleJson<T extends z.ZodTypeAny>(
  schema: T
): z.infer<T> {
  const def = schema._def;

  // Handle primitive and other base types
  if (def.typeName in DEFAULT_PRIMITIVE_VALS) {
    return DEFAULT_PRIMITIVE_VALS[
      def.typeName as keyof typeof DEFAULT_PRIMITIVE_VALS
    ];
  }

  switch (def.typeName) {
    case z.ZodFirstPartyTypeKind.ZodObject: {
      const shape = def.shape();
      const result: Record<string, any> = {};
      for (const key in shape) {
        result[key] = generateZodSampleJson(shape[key]);
      }
      return result as z.infer<T>;
    }
    case z.ZodFirstPartyTypeKind.ZodArray: {
      const elementSchema = def.type;
      return [generateZodSampleJson(elementSchema)] as z.infer<T>;
    }
    case z.ZodFirstPartyTypeKind.ZodEnum: {
      return def.values[0];
    }
    case z.ZodFirstPartyTypeKind.ZodLiteral: {
      return def.value;
    }
    case z.ZodFirstPartyTypeKind.ZodUnion: {
      // Pick the first schema in the union
      return generateZodSampleJson(def.options[0]);
    }
    case z.ZodFirstPartyTypeKind.ZodOptional:
    case z.ZodFirstPartyTypeKind.ZodNullable: {
      // Unpack the inner schema
      return generateZodSampleJson(def.innerType);
    }
    case z.ZodFirstPartyTypeKind.ZodDefault: {
      // Return the default value
      return def.defaultValue();
    }
    case z.ZodFirstPartyTypeKind.ZodEffects: {
      // ZodEffects, like .transform(), can't be easily reversed.
      // We generate the input and let the effect run.
      // This is the one place where we call a Zod method to get the value.
      const input = generateZodSampleJson(def.schema);
      return def.effect.type === 'transform'
        ? def.effect.transform(input, { addIssue: () => {}, path: [] })
        : input;
    }
    case z.ZodFirstPartyTypeKind.ZodIntersection: {
      // Merge two objects together
      const left = generateZodSampleJson(def.left);
      const right = generateZodSampleJson(def.right);
      return { ...left, ...right };
    }
    case z.ZodFirstPartyTypeKind.ZodTuple: {
      return def.items.map((item: z.ZodTypeAny) => generateZodSampleJson(item));
    }
    case z.ZodFirstPartyTypeKind.ZodRecord: {
      const valueSchema = def.valueType;
      // We generate one key-value pair for the record
      const key = 'key';
      const value = generateZodSampleJson(valueSchema);
      return { [key]: value };
    }
    case z.ZodFirstPartyTypeKind.ZodMap: {
      const keySchema = def.keyType;
      const valueSchema = def.valueType;
      const key = generateZodSampleJson(keySchema);
      const value = generateZodSampleJson(valueSchema);
      return new Map([[key, value]]);
    }
    case z.ZodFirstPartyTypeKind.ZodSet: {
      const valueSchema = def.valueType;
      const value = generateZodSampleJson(valueSchema);
      return new Set([value]);
    }
    case z.ZodFirstPartyTypeKind.ZodLazy: {
      // Handle recursive schemas
      return generateZodSampleJson(def.getter());
    }
    default: {
      console.warn(`Zod type '${def.typeName}' not handled. Returning null.`);
      return null;
    }
  }
}
