import {describe, it, expect, vi} from 'vitest';
import {analyzeImages} from './multimodal-analyzer';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLzxQAAAABJRU5ErkJggg==';

describe('analyzeImages', () => {
  it('returns parsed DNA from API', async () => {
    const mockFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'msg_1',
          content: [
            {
              text: JSON.stringify({
                palette: ['#764ba2'],
                composition: 'center',
                lighting: 'soft',
                textures: ['metal'],
                typography: 'sans',
                mood: 'tech',
                design_patterns: ['glow'],
                ip_visibility: {lobster_mascot: true, logo: true},
                key_elements: ['lobster'],
              }),
            },
          ],
          model: 'MiniMax-M3',
        }),
        {status: 200}
      )
    );

    const dna = await analyzeImages([PNG_BASE64], {
      apiKey: 'k',
      baseUrl: 'https://test',
      fetchImpl: mockFetch as any,
    });

    expect(dna.palette).toEqual(['#764ba2']);
    expect(dna.ip_visibility.lobster_mascot).toBe(true);

    const requestBody = JSON.parse((mockFetch as any).mock.calls[0][1].body);
    expect(requestBody.messages[0].content[1]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: PNG_BASE64,
      },
    });
  });

  it('returns empty list on empty input', async () => {
    await expect(
      analyzeImages([], {apiKey: 'k', fetchImpl: vi.fn() as any})
    ).rejects.toThrow();
  });

  it('parses JSON wrapped in a Markdown code fence', async () => {
    const mockFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              text: '```json\n{"palette":["#fff"],"composition":"center","lighting":"soft","textures":[],"typography":"sans","mood":"tech","design_patterns":[],"ip_visibility":{"lobster_mascot":false,"logo":false},"key_elements":[]}\n```',
            },
          ],
        }),
        {status: 200}
      )
    );

    const dna = await analyzeImages([PNG_BASE64], {
      apiKey: 'k',
      baseUrl: 'https://test',
      fetchImpl: mockFetch as any,
    });
    expect(dna.composition).toBe('center');
  });
});
