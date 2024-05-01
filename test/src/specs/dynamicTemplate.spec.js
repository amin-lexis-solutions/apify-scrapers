({ it, xit, moment, _, run, expect, expectAsync, input, describe }) => {
  let runResult;
  beforeAll(async () => {
    try {
      // Running actor to test
      runResult = await run({
        actorId: input.customData.actorId,
        input: {
          startUrls: input.customData.startUrls,
        },
      });
    } catch (error) {
      fail(`Failed to run the actor: ${error}`);
    }
  });
  describe('', () => {
    it('should call actor with ID', async () => {
      await expectAsync(runResult).toHaveStatus('SUCCEEDED');
    });
    it('should not contain ReferenceError', async () => {
      await expectAsync(runResult).withLog((log) => {
        expect(log)
          .withContext(runResult.format('ReferenceError'))

          .not.toContain('ReferenceError');

        expect(log)
          .withContext(runResult.format('TypeError'))

          .not.toContain('TypeError');
      });
    });
    it('should not contain empty dataset', async () => {
      await expectAsync(runResult).withDataset(({ dataset, info }) => {
        expect(info.cleanItemCount)
          .withContext(runResult.format('Dataset cleanItemCount'))

          .toBeGreaterThan(0);

        expect(dataset.items)
          .withContext(runResult.format('Dataset items array'))

          .toBeNonEmptyArray();
      });
    });
    it('should not contain empty dataset', async () => {
      await expectAsync(runResult).withDataset(({ dataset, info }) => {
        expect(info.cleanItemCount)
          .withContext(runResult.format('Dataset cleanItemCount'))

          .toBeGreaterThan(0);

        expect(dataset.items)
          .withContext(runResult.format('Dataset items array'))

          .toBeNonEmptyArray();
      });
    });
  });
};
