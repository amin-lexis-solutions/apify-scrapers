// Prepare Actor input
export async function createTest(
  actorId,
  input,
  testName,
  slackChannel,
  slackPrefix
) {
  return {
    testSpec: ({ it, run, expect, expectAsync, describe }) => {
      describe(`Actor testing`, () => {
        it(
          'Call actor by id',
          async ({ actorId, input }) => {
            const runResult = await run({ actorId, input });

            await expectAsync(runResult).toHaveStatus('SUCCEEDED');

            // check log for errors
            await expectAsync(runResult).withLog((log) => {
              expect(log).not.toContain('ReferenceError');
              expect(log).not.toContain('TypeError');
              expect(log).not.toContain(
                'The function passed to Apify.main() threw an exception'
              );
            });
            await expectAsync(runResult).withDataset(({ dataset, info }) => {
              expect(dataset.items)
                .withContext(runResult.format('Dataset items array'))

                .toBeNonEmptyArray();
            });
          },
          { actorId, input }
        );
      });
    },
    testName: testName,
    slackChannel: slackChannel,
    slackPrefix: slackPrefix,
  };
}

export function inputValidator(inputs) {
  const validInputs = inputs.filter((item) => item?.input && item?.actorId);

  if (validInputs.length == 0) {
    throw new Error('Actor input data is required!');
  }

  return validInputs;
}
