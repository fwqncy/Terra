# Terra web app

Angular 22 front end plus the plain-JavaScript simulation engine (`src/engine`) and the React Three Fiber 3D islands (`src/islands`).

```bash
npm install
npm start               # http://localhost:4200 (proxies /api to http://localhost:5080)
npm run test:engine     # engine tests (node --test)
npx ng test             # Angular unit tests (Vitest)
npx ng build            # production build → dist/web/browser
```

See the [project README](../README.md) for the full picture.
