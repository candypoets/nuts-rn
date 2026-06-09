declare global {
  interface TextEncoder {
    encode(input?: string): Uint8Array;
  }

  interface TextEncoderConstructor {
    new (): TextEncoder;
  }

  interface TextDecoder {
    decode(input?: ArrayBuffer | ArrayBufferView | null): string;
  }

  interface TextDecoderConstructor {
    new (): TextDecoder;
  }

  var TextEncoder: TextEncoderConstructor;
  var TextDecoder: TextDecoderConstructor;
}

export {};
