// Thin HTTP adapter: translate request -> service call -> response. No business logic here.
// Express 5 forwards rejected promises to the error handler, so no try/catch needed.
export function createTranscriptionController(service) {
  return {
    list: async (req, res) => res.json(await service.list(req.valid.query)),

    get: async (req, res) => res.json(await service.get(req.valid.params.id)),

    create: async (req, res) => {
      const record = await service.create(req.valid.body);
      res.status(201).location(`/api/transcriptions/${record.id}`).json(record);
    },

    update: async (req, res) => res.json(await service.update(req.valid.params.id, req.valid.body)),

    remove: async (req, res) => {
      await service.remove(req.valid.params.id);
      res.status(204).end();
    },
  };
}
