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
    it('should run successfully', async () => {
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

    it('should contain coupons', async () => {
      await expectAsync(runResult).withDataset(({ dataset, info }) => {
        expect(info.cleanItemCount)
          .withContext(runResult.format('Dataset cleanItemCount'))
          .toBeGreaterThan(0);
      });
    });

    it('should not contain empty dataset', async () => {
      await expectAsync(runResult).withDataset(({ dataset, info }) => {
        expect(dataset.items)
          .withContext(runResult.format('Dataset items array'))
          .toBeNonEmptyArray();
      });
    });
  });

  describe('Dataset', () => {
    const couponFields = [
      'idInSite',
      'domain',
      'merchantName',
      'title',
      'description',
      'termsAndConditions',
      'expiryDateAt',
      'code',
      'startDateAt',
      'sourceUrl',
      'isShown',
      'isExpired',
      'isExclusive',
    ];
    const undefinedFields = [];

    it('should contain required fields', async () => {
      await expectAsync(runResult).withDataset(({ dataset, info }) => {
        for (const coupon of dataset.items) {
          for (const field of couponFields) {
            expect(coupon[field]).toBeDefined();

            if (coupon[field] === undefined || coupon[field] === null) {
              undefinedFields.push({
                coupon,
                requiredField: field,
              });
            }
          }
        }
      });
    });

    // Print undefined fields
    if (undefinedFields.length > 0) {
      console.log('Undefined fields found:', undefinedFields);
    }
  });

  describe('Stats', () => {
    it('should have less than 3 request retries', async () => {
      await expectAsync(runResult).withStatistics((stats) => {
        expect(stats.requestsRetries)
          .withContext(runResult.format('Request retries'))
          .toBeLessThan(3);
      });
    });

    it('should have runtime less than 10 min', async () => {
      await expectAsync(runResult).withStatistics((stats) => {
        expect(stats.crawlerRuntimeMillis)
          .withContext(runResult.format('Run time'))
          .toBeLessThan(10 * 60000);
      });
    });
  });
};
