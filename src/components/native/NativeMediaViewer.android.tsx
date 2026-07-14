// The native component contract and JS event bridge are intentionally shared
// with iOS. Keeping one wrapper prevents the two platforms from drifting while
// their native renderers provide the platform-specific implementation.
export * from './NativeMediaViewer.ios';
