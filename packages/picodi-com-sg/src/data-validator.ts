enum ValidationResultCode {
  INVALID_KEY,
  INVALID_VALUE,
  VALUE_ADDED,
  MISSING_REQUIRED_FIELD,
}

type SchemaType = 'string' | 'number' | 'boolean' | 'date';

interface FieldSchema {
  type: SchemaType;
  required: boolean;
}

class DataValidator {
  private data: Record<string, any> = {};
  private schema: Record<string, FieldSchema> = {
    idInSite: { type: 'string', required: true },
    domain: { type: 'string', required: false },
    merchantName: { type: 'string', required: true },
    title: { type: 'string', required: true },
    description: { type: 'string', required: false },
    termsAndConditions: { type: 'string', required: false },
    expiryDateAt: { type: 'string', required: false },
    code: { type: 'string', required: false },
    startDateAt: { type: 'string', required: false },
    sourceUrl: { type: 'string', required: true },
    isShown: { type: 'boolean', required: false },
    isExpired: { type: 'boolean', required: false },
    isExclusive: { type: 'boolean', required: false }
  };

  addValue(key: string, value: any): ValidationResultCode {
    if (!(key in this.schema)) {
      return ValidationResultCode.INVALID_KEY;
    }

    const fieldInfo = this.schema[key];

    if (this.validateValue(value, fieldInfo.type)) {
      this.data[key] = this.convertValue(value, fieldInfo.type);
      return ValidationResultCode.VALUE_ADDED;
    } else {
      return ValidationResultCode.INVALID_VALUE;
    }
  }

  finalCheck(): void {
    for (const key in this.schema) {
      if (this.schema[key].required && !(key in this.data)) {
        throw new Error(`Missing required field: ${key}`);
      }
    }
  }

  getData(): Record<string, any> {
    return this.data;
  }

  loadData(data: Record<string, any>): void {
    for (const [key, value] of Object.entries(data)) {
      this.addValue(key, value);
    }
  }

  private validateValue(value: any, type: SchemaType): boolean {
    switch (type) {
      case 'string':
        return (
          (typeof value === 'string' && String(value).trim() != '') ||
          typeof value === 'number' ||
          value instanceof Date
        );
      case 'number':
        return (
          typeof value === 'number' ||
          (!isNaN(value) && !isNaN(parseFloat(value)))
        );
      case 'boolean':
        return typeof value === 'boolean';
      case 'date':
        return value instanceof Date || !isNaN(Date.parse(value));
      default:
        return false;
    }
  }

  private convertValue(value: any, type: SchemaType): any {
    switch (type) {
      case 'string':
        if (typeof value === 'number') {
          return value.toString();
        } else if (value instanceof Date) {
          return value.toISOString();
        } else {
          return String(value).trim();
        }
      case 'number':
        return Number(value);
      case 'boolean':
        return !!value;
      case 'date':
        return new Date(value);
      default:
        return value;
    }
  }
}

export { DataValidator };

// Usage example:
// let validator = new DataValidator();
// console.log(validator.addValue('name', ' John Doe ')); // Should trim and add
// console.log(validator.addValue('age', '30')); // Should convert to number and add
// console.log(validator.addValue('isEmployed', null)); // Should be invalid
// validator.finalCheck(); // Should throw an error if required fields are missing
// console.log(validator.getData()); // Should return the populated object
