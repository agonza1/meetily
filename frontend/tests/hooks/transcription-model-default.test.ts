import { expect, test } from 'bun:test';
import { DEFAULT_PARAKEET_MODEL } from '../../src/constants/modelDefaults';
import { getDefaultTranscriptionModel, type ModelOption } from '../../src/hooks/useTranscriptionModels';
import { PARAKEET_MLX_MODEL } from '../../src/lib/parakeet';

const whisper: ModelOption = {
  provider: 'whisper', name: 'base.en', displayName: 'Whisper Base', size_mb: 141,
};
const lightning: ModelOption = {
  provider: 'parakeet', name: DEFAULT_PARAKEET_MODEL, displayName: 'Lightning', size_mb: 670,
};

test('offline import and retranscription use Lightning when recording settings select MLX', () => {
  const models = [whisper, lightning];
  expect(getDefaultTranscriptionModel(models, { provider: 'parakeet', model: PARAKEET_MLX_MODEL })).toBe(lightning);
  expect(getDefaultTranscriptionModel(models, { provider: 'localWhisper', model: whisper.name })).toBe(whisper);
});
