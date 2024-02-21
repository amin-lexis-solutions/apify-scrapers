/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-var-requires */
export async function useNgrok(port: number | string) {
  console.info(
    `Attempting to expose the server to the internet using ngrok...`
  );

  return new Promise((resolve, reject) => {
    try {
      const ngrok = require('ngrok');
      ngrok.connect(port).then((url: string) => {
        process.env.BASE_URL = url;
        console.log(
          `Server accesible to the internet. process.env.BASE_URL=${url}`
        );

        resolve(true);
      });

      // handle nodemon restarts
      process.once('SIGUSR2', () => {
        ngrok.kill().then(() => {
          process.kill(process.pid, 'SIGUSR2');
        });
      });
    } catch (e) {
      console.error('Failed to expose the server to the internet using ngrok');
      reject(e);
    }
  });
}
