import config from '@lummi/config/eslint';

export default [...config, { ignores: ['.next/**', 'next-env.d.ts'] }];
