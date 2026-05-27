const storage = new Map();

module.exports = {
  __esModule: true,
  default: {
    getItem: async key => (storage.has(key) ? storage.get(key) : null),
    setItem: async (key, value) => {
      storage.set(key, value);
    },
    removeItem: async key => {
      storage.delete(key);
    },
    clear: async () => {
      storage.clear();
    },
  },
};
