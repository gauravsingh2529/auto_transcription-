import { Router } from 'express';
import { createTranscriptionController } from '../controllers/transcription.controller.js';
import { validate } from '../middleware/validate.js';
import {
  createBody,
  idParams,
  listQuery,
  updateBody,
} from '../validation/transcription.schema.js';

export function createTranscriptionRouter(service) {
  const c = createTranscriptionController(service);
  const router = Router();

  router.get('/', validate({ query: listQuery }), c.list);
  router.post('/', validate({ body: createBody }), c.create);
  router.get('/:id', validate({ params: idParams }), c.get);
  router.patch('/:id', validate({ params: idParams, body: updateBody }), c.update);
  router.put('/:id', validate({ params: idParams, body: updateBody }), c.update);
  router.delete('/:id', validate({ params: idParams }), c.remove);

  return router;
}
