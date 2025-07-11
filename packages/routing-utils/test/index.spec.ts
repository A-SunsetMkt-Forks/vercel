import assert from 'assert';
import Ajv from 'ajv';
import {
  Route,
  normalizeRoutes,
  isHandler,
  routesSchema,
  rewritesSchema,
  redirectsSchema,
  headersSchema,
  cleanUrlsSchema,
  trailingSlashSchema,
  getTransformedRoutes,
  hasSchema,
} from '../src';

const ajv = new Ajv();

const assertValid = (data: unknown, schema: object = routesSchema) => {
  const validate = ajv.compile(schema);
  const valid = validate(data);

  if (!valid) console.log(validate.errors);
  assert.equal(valid, true);
};

const assertError = (
  data: unknown,
  errors: Ajv.ErrorObject[],
  schema: object = routesSchema
) => {
  const validate = ajv.compile(schema);
  const valid = validate(data);

  assert.equal(valid, false);
  assert.deepEqual(validate.errors, errors);
};

describe('normalizeRoutes', () => {
  test('should return routes null if provided routes is null', () => {
    const actual = normalizeRoutes(null);
    assert.equal(actual.routes, null);
  });

  test('accepts valid routes', () => {
    const routes: Route[] = [
      {
        src: '^(?:/(?<value>en|fr))?(?<path>/.*)$',
        locale: {
          // @ts-expect-error `value` is not defined… is this a bug or should this prop be added to the type?
          value: '$value',
          path: '$path',
          default: 'en',
          cookie: 'NEXT_LOCALE',
        },
      },
      {
        src: '^/(?:en/?|fr/?)$',
        locale: {
          redirect: { en: '/en', fr: '/fr' },
        },
      },
      { src: '^/about$' },
      { src: '^/about$', middleware: 0 },
      { src: '^/about$', middlewarePath: 'pages/_middleware' },
      {
        src: '^/blog$',
        methods: ['GET'],
        headers: { 'Cache-Control': 'no-cache' },
        dest: '/blog',
      },
      {
        src: '^/.*$',
        middleware: 0,
      },
      { handle: 'filesystem' },
      { src: '^/(?<slug>[^/]+)$', dest: 'blog?slug=$slug' },
      { handle: 'hit' },
      {
        src: '^/hit-me$',
        headers: { 'Cache-Control': 'max-age=20' },
        continue: true,
      },
      { handle: 'miss' },
      { src: '^/missed-me$', dest: '/api/missed-me', check: true },
      {
        src: '^/missed-me$',
        headers: { 'Cache-Control': 'max-age=10' },
        continue: true,
        important: true,
      },
      { handle: 'rewrite' },
      { src: '^.*$', dest: '/somewhere' },
      { handle: 'error' },
      {
        src: '^.*$',
        dest: '/404',
        status: 404,
      },
      {
        src: '^/hello$',
        dest: '/another',
        has: [
          { type: 'header', key: 'x-rewrite' },
          { type: 'cookie', key: 'loggedIn', value: 'yup' },
          { type: 'query', key: 'authorized', value: 'yup' },
          { type: 'host', value: 'vercel.com' },
        ],
        missing: [
          { type: 'header', key: 'x-middleware-subrequest', value: 'secret' },
        ],
      },
    ];

    assertValid(routes);

    const normalized = normalizeRoutes(routes);
    assert.equal(normalized.error, null);
    assert.deepStrictEqual(normalized.routes, routes);
  });

  test('normalizes src', () => {
    const expected = '^/about$';
    const sources = [
      { src: '/about' },
      { src: '/about$' },
      { src: '\\/about' },
      { src: '\\/about$' },
      { src: '^/about' },
      { src: '^/about$' },
      { src: '^\\/about' },
      { src: '^\\/about$' },
    ];

    assertValid(sources);

    const normalized = normalizeRoutes(sources);

    assert.equal(normalized.error, null);
    assert.notEqual(normalized.routes, null);

    if (normalized.routes) {
      normalized.routes.forEach(route => {
        if (isHandler(route)) {
          assert.fail(
            `Normalizer returned: { handle: ${route.handle} } instead of { src: ${expected} }`
          );
        } else {
          assert.strictEqual(route.src, expected);
        }
      });
    }
  });

  test('returns if null', () => {
    const input = null;
    const { error, routes } = normalizeRoutes(input);

    assert.strictEqual(error, null);
    assert.strictEqual(routes, input);
  });

  test('returns if empty', () => {
    const input: Route[] = [];
    const { error, routes } = normalizeRoutes(input);

    assert.strictEqual(error, null);
    assert.strictEqual(routes, input);
  });

  test('fails if route has unknown `handle` value', () => {
    // @ts-expect-error - intentionally passing invalid "handle"
    const input: Route[] = [{ handle: 'doesnotexist' }];
    const { error } = normalizeRoutes(input);

    assert.deepEqual(error?.code, 'invalid_route');
    assert.deepEqual(
      error?.message,
      'Route at index 0 has unknown handle value `handle: doesnotexist`.'
    );
  });

  test('fails if route has additional properties with `handle` property', () => {
    // @ts-expect-error - intentionally passing invalid property
    const input: Route[] = [{ handle: 'filesystem', illegal: true }];
    const { error } = normalizeRoutes(input);

    assert.deepEqual(error?.code, 'invalid_route');
    assert.deepEqual(
      error?.message,
      'Route at index 0 has unknown property `illegal`.'
    );
  });

  test('fails if route has a duplicate `handle` value', () => {
    const input: Route[] = [{ handle: 'filesystem' }, { handle: 'filesystem' }];
    const { error } = normalizeRoutes(input);

    assert.deepEqual(error?.code, 'invalid_route');
    assert.deepEqual(
      error?.message,
      'Route at index 1 is a duplicate. Please use one `handle: filesystem` at most.'
    );
  });

  test('fails if route has a invalid regex', () => {
    const input: Route[] = [{ src: '^/(broken]$' }];
    const { error } = normalizeRoutes(input);

    assert.deepEqual(error?.code, 'invalid_route');
    assert.deepEqual(
      error?.message,
      'Route at index 0 has invalid `src` regular expression "^/(broken]$".'
    );
  });

  test('fails if route does not define `handle` or `src` property', () => {
    // @ts-expect-error - intentionally passing invalid property
    const input: Route[] = [{ fake: 'foo' }];
    const { error } = normalizeRoutes(input);

    assert.deepEqual(error?.code, 'invalid_route');
    assert.deepEqual(
      error?.message,
      'Route at index 0 must define either `handle` or `src` property.'
    );
  });

  test('fails is src is not string', () => {
    assertError(
      [
        {
          src: false,
        },
      ],
      [
        {
          keyword: 'type',
          dataPath: '[0].src',
          schemaPath: '#/items/anyOf/0/properties/src/type',
          params: { type: 'string' },
          message: 'should be string',
        },
        {
          keyword: 'additionalProperties',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf/1/additionalProperties',
          params: { additionalProperty: 'src' },
          message: 'should NOT have additional properties',
        },
        {
          keyword: 'anyOf',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf',
          params: {},
          message: 'should match some schema in anyOf',
        },
      ]
    );
  });

  test('fails if dest is not string', () => {
    assertError(
      [
        // @ts-ignore
        {
          dest: false,
        },
      ],
      [
        {
          keyword: 'required',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf/0/required',
          params: { missingProperty: 'src' },
          message: "should have required property 'src'",
        },
        {
          keyword: 'additionalProperties',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf/1/additionalProperties',
          params: { additionalProperty: 'dest' },
          message: 'should NOT have additional properties',
        },
        {
          keyword: 'anyOf',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf',
          params: {},
          message: 'should match some schema in anyOf',
        },
      ]
    );
  });

  test('fails if methods is not array', () => {
    assertError(
      [
        // @ts-ignore
        {
          methods: false,
        },
      ],
      [
        {
          keyword: 'required',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf/0/required',
          params: { missingProperty: 'src' },
          message: "should have required property 'src'",
        },
        {
          keyword: 'additionalProperties',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf/1/additionalProperties',
          params: { additionalProperty: 'methods' },
          message: 'should NOT have additional properties',
        },
        {
          keyword: 'anyOf',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf',
          params: {},
          message: 'should match some schema in anyOf',
        },
      ]
    );
  });

  test('fails if methods is not string', () => {
    assertError(
      [
        // @ts-ignore
        {
          methods: [false],
        },
      ],
      [
        {
          keyword: 'required',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf/0/required',
          params: { missingProperty: 'src' },
          message: "should have required property 'src'",
        },
        {
          keyword: 'additionalProperties',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf/1/additionalProperties',
          params: { additionalProperty: 'methods' },
          message: 'should NOT have additional properties',
        },
        {
          keyword: 'anyOf',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf',
          params: {},
          message: 'should match some schema in anyOf',
        },
      ]
    );
  });

  test('fails if headers is not an object', () => {
    assertError(
      [
        // @ts-ignore
        {
          headers: false,
        },
      ],
      [
        {
          keyword: 'required',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf/0/required',
          params: { missingProperty: 'src' },
          message: "should have required property 'src'",
        },
        {
          keyword: 'additionalProperties',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf/1/additionalProperties',
          params: { additionalProperty: 'headers' },
          message: 'should NOT have additional properties',
        },
        {
          keyword: 'anyOf',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf',
          params: {},
          message: 'should match some schema in anyOf',
        },
      ]
    );
  });

  test('fails if header is not a string', () => {
    assertError(
      [
        // @ts-ignore
        {
          headers: {
            test: false,
          },
        },
      ],
      [
        {
          keyword: 'required',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf/0/required',
          params: { missingProperty: 'src' },
          message: "should have required property 'src'",
        },
        {
          keyword: 'additionalProperties',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf/1/additionalProperties',
          params: { additionalProperty: 'headers' },
          message: 'should NOT have additional properties',
        },
        {
          keyword: 'anyOf',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf',
          params: {},
          message: 'should match some schema in anyOf',
        },
      ]
    );
  });

  test('fails if handle is not string', () => {
    assertError(
      [
        // @ts-ignore
        {
          handle: false,
        },
      ],
      [
        {
          keyword: 'additionalProperties',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf/0/additionalProperties',
          params: { additionalProperty: 'handle' },
          message: 'should NOT have additional properties',
        },
        {
          keyword: 'type',
          dataPath: '[0].handle',
          schemaPath: '#/items/anyOf/1/properties/handle/type',
          params: { type: 'string' },
          message: 'should be string',
        },
        {
          keyword: 'anyOf',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf',
          params: {},
          message: 'should match some schema in anyOf',
        },
      ]
    );
  });

  test('fails if continue is not boolean', () => {
    assertError(
      [
        // @ts-ignore
        {
          continue: 'false',
        },
      ],
      [
        {
          keyword: 'required',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf/0/required',
          params: { missingProperty: 'src' },
          message: "should have required property 'src'",
        },
        {
          keyword: 'additionalProperties',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf/1/additionalProperties',
          params: { additionalProperty: 'continue' },
          message: 'should NOT have additional properties',
        },
        {
          keyword: 'anyOf',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf',
          params: {},
          message: 'should match some schema in anyOf',
        },
      ]
    );
  });

  test('fails if check is not boolean', () => {
    assertError(
      [
        // @ts-ignore
        {
          check: 'false',
        },
      ],
      [
        {
          keyword: 'required',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf/0/required',
          params: { missingProperty: 'src' },
          message: "should have required property 'src'",
        },
        {
          keyword: 'additionalProperties',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf/1/additionalProperties',
          params: { additionalProperty: 'check' },
          message: 'should NOT have additional properties',
        },
        {
          keyword: 'anyOf',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf',
          params: {},
          message: 'should match some schema in anyOf',
        },
      ]
    );
  });

  test('fails if status is not number', () => {
    assertError(
      [
        // @ts-ignore
        {
          status: '404',
        },
      ],
      [
        {
          keyword: 'required',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf/0/required',
          params: { missingProperty: 'src' },
          message: "should have required property 'src'",
        },
        {
          keyword: 'additionalProperties',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf/1/additionalProperties',
          params: { additionalProperty: 'status' },
          message: 'should NOT have additional properties',
        },
        {
          keyword: 'anyOf',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf',
          params: {},
          message: 'should match some schema in anyOf',
        },
      ]
    );
  });

  test('fails if property does not exist', () => {
    assertError(
      [
        {
          // @ts-ignore
          doesNotExist: false,
        },
      ],
      [
        {
          keyword: 'additionalProperties',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf/0/additionalProperties',
          params: { additionalProperty: 'doesNotExist' },
          message: 'should NOT have additional properties',
        },
        {
          keyword: 'additionalProperties',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf/1/additionalProperties',
          params: { additionalProperty: 'doesNotExist' },
          message: 'should NOT have additional properties',
        },
        {
          keyword: 'anyOf',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf',
          params: {},
          message: 'should match some schema in anyOf',
        },
      ]
    );
  });

  test('fails if redirects permanent is not a boolean', () => {
    assertError(
      [
        {
          source: '/foo',
          destination: '/bar',
          permanent: 301,
        },
      ],
      [
        {
          dataPath: '[0].permanent',
          keyword: 'type',
          message: 'should be boolean',
          params: {
            type: 'boolean',
          },
          schemaPath: '#/items/properties/permanent/type',
        },
      ],
      redirectsSchema
    );
  });

  test('fails if redirects statusCode is not a number', () => {
    assertError(
      [
        {
          source: '/foo',
          destination: '/bar',
          statusCode: '301',
        },
      ],
      [
        {
          dataPath: '[0].statusCode',
          keyword: 'type',
          message: 'should be integer',
          params: {
            type: 'integer',
          },
          schemaPath: '#/items/properties/statusCode/type',
        },
      ],
      redirectsSchema
    );
  });

  test('fails if routes after `handle: hit` use `dest`', () => {
    const input: Route[] = [
      {
        handle: 'hit',
      },
      {
        src: '^/user$',
        dest: '^/api/user$',
      },
    ];
    const { error } = normalizeRoutes(input);

    assert.deepEqual(error?.code, 'invalid_route');
    assert.deepEqual(
      error?.message,
      'Route at index 1 cannot define `dest` after `handle: hit`.'
    );
  });

  test('fails if routes after `handle: hit` do not use `continue: true`', () => {
    const input: Route[] = [
      {
        handle: 'hit',
      },
      {
        src: '^/user$',
        headers: { 'Cache-Control': 'no-cache' },
      },
    ];
    const { error } = normalizeRoutes(input);

    assert.deepEqual(error?.code, 'invalid_route');
    assert.deepEqual(
      error?.message,
      'Route at index 1 must define `continue: true` after `handle: hit`.'
    );
  });

  test('fails if routes after `handle: hit` use `status', () => {
    const input: Route[] = [
      {
        handle: 'hit',
      },
      {
        src: '^/(.*)$',
        status: 404,
        continue: true,
      },
    ];
    const { error } = normalizeRoutes(input);

    assert.deepEqual(error?.code, 'invalid_route');
    assert.deepEqual(
      error?.message,
      'Route at index 1 cannot define `status` after `handle: hit`.'
    );
  });

  test('fails if routes after `handle: miss` do not use `check: true`', () => {
    const input: Route[] = [
      {
        handle: 'miss',
      },
      {
        src: '^/user$',
        dest: '^/api/user$',
      },
    ];
    const { error } = normalizeRoutes(input);

    assert.deepEqual(error?.code, 'invalid_route');
    assert.deepEqual(
      error?.message,
      'Route at index 1 must define `check: true` after `handle: miss`.'
    );
  });

  test('fails if routes after `handle: miss` do not use `continue: true`', () => {
    const input: Route[] = [
      {
        handle: 'miss',
      },
      {
        src: '^/user$',
        headers: { 'Cache-Control': 'no-cache' },
      },
    ];
    const { error } = normalizeRoutes(input);

    assert.deepEqual(error?.code, 'invalid_route');
    assert.deepEqual(
      error?.message,
      'Route at index 1 must define `continue: true` after `handle: miss`.'
    );
  });

  test('should fail validation when append operation is missing required args', () => {
    const routes: Route[] = [
      {
        src: '/api/(.*)',
        transforms: [
          {
            type: 'request.headers',
            op: 'append',
            target: {
              key: 'x-custom-header',
            },
          },
        ],
      },
    ];

    assertError(
      routes,
      [
        {
          dataPath: '[0].transforms[0]',
          keyword: 'required',
          message: "should have required property '.args'",
          params: { missingProperty: '.args' },
          schemaPath:
            '#/items/anyOf/0/properties/transforms/items/allOf/0/then/required',
        },
        {
          dataPath: '[0].transforms[0]',
          keyword: 'if',
          message: 'should match "then" schema',
          params: { failingKeyword: 'then' },
          schemaPath: '#/items/anyOf/0/properties/transforms/items/allOf/0/if',
        },
        {
          dataPath: '[0]',
          keyword: 'additionalProperties',
          message: 'should NOT have additional properties',
          params: { additionalProperty: 'src' },
          schemaPath: '#/items/anyOf/1/additionalProperties',
        },
        {
          dataPath: '[0]',
          keyword: 'anyOf',
          message: 'should match some schema in anyOf',
          params: {},
          schemaPath: '#/items/anyOf',
        },
      ],
      routesSchema
    );
  });

  test('should fail validation when set operation is missing required args', () => {
    const routes: Route[] = [
      {
        src: '/api/(.*)',
        transforms: [
          {
            type: 'response.headers',
            op: 'set',
            target: {
              key: 'cache-control',
            },
          },
        ],
      },
    ];

    assertError(
      routes,
      [
        {
          dataPath: '[0].transforms[0]',
          keyword: 'required',
          message: "should have required property '.args'",
          params: { missingProperty: '.args' },
          schemaPath:
            '#/items/anyOf/0/properties/transforms/items/allOf/0/then/required',
        },
        {
          dataPath: '[0].transforms[0]',
          keyword: 'if',
          message: 'should match "then" schema',
          params: { failingKeyword: 'then' },
          schemaPath: '#/items/anyOf/0/properties/transforms/items/allOf/0/if',
        },
        {
          dataPath: '[0]',
          keyword: 'additionalProperties',
          message: 'should NOT have additional properties',
          params: { additionalProperty: 'src' },
          schemaPath: '#/items/anyOf/1/additionalProperties',
        },
        {
          dataPath: '[0]',
          keyword: 'anyOf',
          message: 'should match some schema in anyOf',
          params: {},
          schemaPath: '#/items/anyOf',
        },
      ],
      routesSchema
    );
  });

  test('should pass validation when delete operation has no args', () => {
    const routes: Route[] = [
      {
        src: '/api/(.*)',
        transforms: [
          {
            type: 'request.headers',
            op: 'delete',
            target: {
              key: 'x-unwanted-header',
            },
            // No args needed for delete operation
          },
        ],
      },
    ];

    assertValid(routes, routesSchema);
  });

  test('should pass validation when all operations have required args', () => {
    const routes: Route[] = [
      {
        src: '/api/(.*)',
        transforms: [
          {
            type: 'request.headers',
            op: 'append',
            target: {
              key: 'x-custom-header',
            },
            args: 'additional-value',
          },
          {
            type: 'response.headers',
            op: 'set',
            target: {
              key: 'cache-control',
            },
            args: 'max-age=3600',
          },
          {
            type: 'request.headers',
            op: 'delete',
            target: {
              key: 'x-unwanted-header',
            },
            args: 'optional-value',
          },
        ],
      },
    ];

    assertValid(routes, routesSchema);
  });
});

describe('getTransformedRoutes', () => {
  test('should normalize vercelConfig.routes', () => {
    const vercelConfig = { routes: [{ src: '/page', dest: '/page.html' }] };
    const actual = getTransformedRoutes(vercelConfig);
    const expected = normalizeRoutes(vercelConfig.routes);
    assert.deepEqual(actual, expected);
    assertValid(actual.routes);
  });

  test('should not error when routes is null and cleanUrls is true', () => {
    const vercelConfig = { cleanUrls: true, routes: null };
    // @ts-expect-error intentionally passing invalid `routes: null` here
    const actual = getTransformedRoutes(vercelConfig);
    assert.equal(actual.error, null);
    assertValid(actual.routes);
  });

  test('should not error when has segment is used in destination', () => {
    const vercelConfig = {
      redirects: [
        {
          source: '/redirect',
          destination: '/:url',
          has: [
            {
              type: 'query',
              key: 'url',
              value: '(?<url>.*)',
            },
          ],
        },
      ],
    };

    // @ts-expect-error not sure if this one is an error or not…
    const actual = getTransformedRoutes(vercelConfig);
    assert.equal(actual.error, null);
    assertValid(actual.routes);
  });

  test('should error when routes is defined and cleanUrls is true', () => {
    const vercelConfig = {
      cleanUrls: true,
      routes: [{ src: '/page', dest: '/file.html' }],
    };
    const { error } = getTransformedRoutes(vercelConfig);
    assert.notEqual(error, null);
    assert.equal(error?.code, 'invalid_mixed_routes');
    assert.equal(
      error?.message,
      'If `rewrites`, `redirects`, `headers`, `cleanUrls` or `trailingSlash` are used, then `routes` cannot be present.'
    );
    assert.ok(error?.link);
    assert.ok(error?.action);
  });

  test('should error when redirects is invalid regex', () => {
    const vercelConfig = {
      redirects: [{ source: '^/(*.)\\.html$', destination: '/file.html' }],
    };
    const { error } = getTransformedRoutes(vercelConfig);
    assert.notEqual(error, null);
    assert.equal(error?.code, 'invalid_redirect');
    assert.equal(
      error?.message,
      'Redirect at index 0 has invalid `source` regular expression "^/(*.)\\.html$".'
    );
    assert.ok(error?.link);
    assert.ok(error?.action);
  });

  test('should error when redirects is invalid pattern', () => {
    const vercelConfig = {
      redirects: [{ source: '/:?', destination: '/file.html' }],
    };
    const { error } = getTransformedRoutes(vercelConfig);
    assert.notEqual(error, null);
    assert.equal(error?.code, 'invalid_redirect');
    assert.equal(
      error?.message,
      'Redirect at index 0 has invalid `source` pattern "/:?".'
    );
    assert.ok(error?.link);
    assert.ok(error?.action);
  });

  test('should error when redirects defines both permanent and statusCode', () => {
    const vercelConfig = {
      redirects: [
        {
          source: '^/both$',
          destination: '/api/both',
          permanent: false,
          statusCode: 302,
        },
      ],
    };
    const { error } = getTransformedRoutes(vercelConfig);
    assert.notEqual(error, null);
    assert.equal(error?.code, 'invalid_redirect');
    assert.equal(
      error?.message,
      'Redirect at index 0 cannot define both `permanent` and `statusCode` properties.'
    );
    assert.ok(error?.link);
    assert.ok(error?.action);
  });

  test('should error when headers is invalid regex', () => {
    const vercelConfig = {
      headers: [
        {
          source: '^/(*.)\\.html$',
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=0, must-revalidate',
            },
          ],
        },
      ],
    };
    const { error } = getTransformedRoutes(vercelConfig);
    assert.notEqual(error, null);
    assert.equal(error?.code, 'invalid_header');
    assert.equal(
      error?.message,
      'Header at index 0 has invalid `source` regular expression "^/(*.)\\.html$".'
    );
    assert.ok(error?.link);
    assert.ok(error?.action);
  });

  test('should error when headers is invalid pattern', () => {
    const vercelConfig = {
      headers: [
        { source: '/:?', headers: [{ key: 'x-hello', value: 'world' }] },
      ],
    };
    const { error } = getTransformedRoutes(vercelConfig);
    assert.notEqual(error, null);
    assert.equal(error?.code, 'invalid_header');
    assert.equal(
      error?.message,
      'Header at index 0 has invalid `source` pattern "/:?".'
    );
    assert.ok(error?.link);
    assert.ok(error?.action);
  });

  test('should error when rewrites is invalid regex', () => {
    const vercelConfig = {
      rewrites: [{ source: '^/(*.)\\.html$', destination: '/file.html' }],
    };
    const { error } = getTransformedRoutes(vercelConfig);
    assert.notEqual(error, null);
    assert.equal(error?.code, 'invalid_rewrite');
    assert.equal(
      error?.message,
      'Rewrite at index 0 has invalid `source` regular expression "^/(*.)\\.html$".'
    );
    assert.ok(error?.link);
    assert.ok(error?.action);
  });

  test('should error when rewrites is invalid pattern', () => {
    const vercelConfig = {
      rewrites: [{ source: '/:?', destination: '/file.html' }],
    };
    const { error } = getTransformedRoutes(vercelConfig);
    assert.notEqual(error, null);
    assert.equal(error?.code, 'invalid_rewrite');
    assert.equal(
      error?.message,
      'Rewrite at index 0 has invalid `source` pattern "/:?".'
    );
    assert.ok(error?.link);
    assert.ok(error?.action);
  });

  test('should normalize all redirects before rewrites', () => {
    const vercelConfig = {
      cleanUrls: true,
      rewrites: [{ source: '/v1', destination: '/v2/api.py' }],
      redirects: [
        { source: '/help', destination: '/support', statusCode: 302 },
        {
          source: '/bug',
          destination: 'https://example.com/bug',
          statusCode: 308,
        },
      ],
    };
    const { error, routes } = getTransformedRoutes(vercelConfig);
    const expected = [
      {
        src: '^/(?:(.+)/)?index(?:\\.html)?/?$',
        headers: { Location: '/$1' },
        status: 308,
      },
      {
        src: '^/(.*)\\.html/?$',
        headers: { Location: '/$1' },
        status: 308,
      },
      {
        src: '^/help$',
        headers: { Location: '/support' },
        status: 302,
      },
      {
        src: '^/bug$',
        headers: { Location: 'https://example.com/bug' },
        status: 308,
      },
      { handle: 'filesystem' },
      { src: '^/v1$', dest: '/v2/api.py', check: true },
    ];
    assert.deepEqual(error, null);
    assert.deepEqual(routes, expected);
    assertValid(routes, routesSchema);
  });

  test('should validate schemas', () => {
    const vercelConfig = {
      cleanUrls: true,
      rewrites: [
        { source: '/page', destination: '/page.html' },
        { source: '/home', destination: '/index.html' },
        {
          source: '/home',
          destination: '/another',
          has: [
            { type: 'header', key: 'x-rewrite' },
            { type: 'cookie', key: 'loggedIn', value: 'yup' },
            { type: 'query', key: 'authorized', value: 'yup' },
            { type: 'host', value: 'vercel.com' },
          ],
        },
      ],
      redirects: [
        { source: '/version1', destination: '/api1.py' },
        { source: '/version2', destination: '/api2.py', statusCode: 302 },
        { source: '/version3', destination: '/api3.py', permanent: true },
        {
          source: '/version4',
          destination: '/api4.py',
          has: [
            { type: 'header', key: 'x-redirect' },
            { type: 'cookie', key: 'loggedIn', value: 'yup' },
            { type: 'query', key: 'authorized', value: 'yup' },
            { type: 'host', value: 'vercel.com' },
          ],
          permanent: false,
        },
      ],
      headers: [
        {
          source: '/(.*)',
          headers: [
            {
              key: 'Access-Control-Allow-Origin',
              value: '*',
            },
          ],
        },
        {
          source: '/404',
          headers: [
            {
              key: 'Cache-Control',
              value: 'max-age=300',
            },
            {
              key: 'Set-Cookie',
              value: 'error=404',
            },
          ],
        },
        {
          source: '/add-header',
          has: [
            { type: 'header', key: 'x-header' },
            { type: 'cookie', key: 'loggedIn', value: 'yup' },
            { type: 'query', key: 'authorized', value: 'yup' },
            { type: 'host', value: 'vercel.com' },
          ],
          headers: [
            {
              key: 'Cache-Control',
              value: 'max-age=forever',
            },
          ],
        },
      ],
      trailingSlashSchema: false,
    };
    assertValid(vercelConfig.cleanUrls, cleanUrlsSchema);
    assertValid(vercelConfig.rewrites, rewritesSchema);
    assertValid(vercelConfig.redirects, redirectsSchema);
    assertValid(vercelConfig.headers, headersSchema);
    assertValid(vercelConfig.trailingSlashSchema, trailingSlashSchema);
  });

  test('should return null routes if no transformations are performed', () => {
    const vercelConfig = { routes: null };
    // @ts-expect-error intentionally passing invalid `routes: null`
    const { routes } = getTransformedRoutes(vercelConfig);
    assert.equal(routes, null);
  });

  test('should error when segment is defined in `destination` but not `source`', () => {
    const vercelConfig = {
      redirects: [
        {
          source: '/iforgot/:id',
          destination: '/:another',
        },
      ],
    };
    const { routes, error } = getTransformedRoutes(vercelConfig);
    assert.deepEqual(routes, null);
    assert.ok(
      error?.message.includes(
        'in `destination` property but not in `source` or `has` property'
      ),
      error?.message
    );
  });

  test('should error when segment is defined in HTTPS `destination` but not `source`', () => {
    const vercelConfig = {
      redirects: [
        {
          source: '/iforgot/:id',
          destination: 'https://example.com/:another',
        },
      ],
    };
    const { routes, error } = getTransformedRoutes(vercelConfig);
    assert.deepEqual(routes, null);
    assert.ok(
      error?.message.includes(
        'in `destination` property but not in `source` or `has` property'
      ),
      error?.message
    );
  });

  test('should error when segment is defined in `destination` query string but not `source`', () => {
    const vercelConfig = {
      redirects: [
        {
          source: '/iforgot/:id',
          destination: '/api/login?id=123&name=:name',
        },
      ],
    };
    const { routes, error } = getTransformedRoutes(vercelConfig);
    assert.deepEqual(routes, null);
    assert.ok(
      error?.message.includes(
        'in `destination` property but not in `source` or `has` property'
      ),
      error?.message
    );
  });

  test('should error when segment is defined in HTTPS `destination` query string but not `source`', () => {
    const vercelConfig = {
      redirects: [
        {
          source: '/iforgot/:id',
          destination: 'https://example.com/api/login?id=123&name=:name',
        },
      ],
    };
    const { routes, error } = getTransformedRoutes(vercelConfig);
    assert.deepEqual(routes, null);
    assert.ok(
      error?.message.includes(
        'in `destination` property but not in `source` or `has` property'
      ),
      error?.message
    );
  });

  test('should work with content-security-policy header containing URL', () => {
    const vercelConfig = {
      headers: [
        {
          source: '/(.*)',
          headers: [
            {
              key: 'content-security-policy',
              value:
                "default-src 'self'; script-src 'self'; img-src 'self' https://*.example.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.examplpe.com wss://gateway.example.com; form-action 'self'",
            },
            {
              key: 'feature-policy',
              value:
                "accelerometer 'none'; camera 'none'; geolocation 'none'; gyroscope 'none'; magnetometer 'none'; microphone 'none'; payment 'none'; usb 'none'",
            },
            {
              key: 'referrer-policy',
              value: 'strict-origin-when-cross-origin',
            },
            {
              key: 'strict-transport-security',
              value: 'max-age=31536000; includesubdomains; preload',
            },
            {
              key: 'x-content-type-options',
              value: 'nosniff',
            },
            {
              key: 'x-frame-options',
              value: 'sameorigin',
            },
            {
              key: 'x-xss-protection',
              value: '1; mode=block',
            },
          ],
        },
      ],
    };
    const actual = getTransformedRoutes(vercelConfig);
    assert.deepEqual(actual.routes, [
      {
        continue: true,
        headers: {
          'content-security-policy':
            "default-src 'self'; script-src 'self'; img-src 'self' https://*.example.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.examplpe.com wss://gateway.example.com; form-action 'self'",
          'feature-policy':
            "accelerometer 'none'; camera 'none'; geolocation 'none'; gyroscope 'none'; magnetometer 'none'; microphone 'none'; payment 'none'; usb 'none'",
          'referrer-policy': 'strict-origin-when-cross-origin',
          'strict-transport-security':
            'max-age=31536000; includesubdomains; preload',
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'sameorigin',
          'x-xss-protection': '1; mode=block',
        },
        src: '^(?:/(.*))$',
      },
    ]);
  });

  test('should validate all condition operations for has and missing', () => {
    const vercelConfig = {
      rewrites: [
        {
          source: '/api/:path*',
          destination: '/backend/:path*',
          has: [
            { type: 'header', key: 'authorization', value: 'Bearer .*' },
            { type: 'host', value: 'api\\.example\\.com' },
            { type: 'header', key: 'x-string-eq', value: { eq: 'test' } },
            { type: 'header', key: 'x-number-eq', value: { eq: 123 } },
            { type: 'header', key: 'x-neq', value: { neq: 'test' } },
            { type: 'cookie', key: 'theme', value: { inc: ['light', 'dark'] } },
            {
              type: 'header',
              key: 'x-role',
              value: { ninc: ['admin', 'superadmin'] },
            },
            { type: 'header', key: 'x-prefix', value: { pre: 'test-' } },
            { type: 'header', key: 'x-suffix', value: { suf: '-test' } },
            { type: 'header', key: 'x-regex', value: { re: '^test.*' } },
            { type: 'header', key: 'x-gt', value: { gt: 10 } },
            { type: 'header', key: 'x-gte', value: { gte: 10 } },
            { type: 'header', key: 'x-lt', value: { lt: 10 } },
            { type: 'header', key: 'x-lte', value: { lte: 10 } },
            {
              type: 'header',
              key: 'x-multi-condition',
              value: {
                pre: 'test-',
                suf: '-end',
                inc: ['a', 'b'],
                ninc: ['c', 'd'],
              },
            },
          ],
          missing: [
            { type: 'header', key: 'x-missing-header', value: 'test' },
            { type: 'cookie', key: 'missing-cookie', value: 'test' },
            { type: 'query', key: 'missing-query', value: 'test' },
            { type: 'host', value: 'missing.example.com' },

            {
              type: 'header',
              key: 'x-missing-all',
              value: {
                eq: 'test',
                neq: 'wrong',
                inc: ['a', 'b'],
                ninc: ['c', 'd'],
                pre: 'test-',
                suf: '-test',
                re: '^test',
                gt: 10,
                gte: 10,
                lt: 20,
                lte: 20,
              },
            },
          ],
        },
      ],
    };

    assertValid(vercelConfig.rewrites, rewritesSchema);
  });

  test('it should fail validation for empty condition operation objects', () => {
    assertError(
      [
        {
          type: 'header',
          key: 'x-test',
          value: {},
        },
      ],
      [
        {
          keyword: 'additionalProperties',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf/0/additionalProperties',
          params: { additionalProperty: 'key' },
          message: 'should NOT have additional properties',
        },
        {
          keyword: 'type',
          dataPath: '[0].value',
          schemaPath: '#/items/anyOf/1/properties/value/anyOf/0/type',
          params: { type: 'string' },
          message: 'should be string',
        },
        {
          keyword: 'minProperties',
          dataPath: '[0].value',
          schemaPath: '#/items/anyOf/1/properties/value/anyOf/1/minProperties',
          params: { limit: 1 },
          message: 'should NOT have fewer than 1 properties',
        },
        {
          keyword: 'anyOf',
          dataPath: '[0].value',
          schemaPath: '#/items/anyOf/1/properties/value/anyOf',
          params: {},
          message: 'should match some schema in anyOf',
        },
        {
          keyword: 'anyOf',
          dataPath: '[0]',
          schemaPath: '#/items/anyOf',
          params: {},
          message: 'should match some schema in anyOf',
        },
      ],
      hasSchema
    );
  });

  test('should fail validation for invalid properties in condition operation objects', () => {
    assertError(
      [
        {
          type: 'header',
          key: 'x-test',
          value: {
            invalid: 'invalid',
          },
        },
      ],
      [
        {
          dataPath: '[0]',
          keyword: 'additionalProperties',
          message: 'should NOT have additional properties',
          params: { additionalProperty: 'key' },
          schemaPath: '#/items/anyOf/0/additionalProperties',
        },
        {
          dataPath: '[0].value',
          keyword: 'type',
          message: 'should be string',
          params: { type: 'string' },
          schemaPath: '#/items/anyOf/1/properties/value/anyOf/0/type',
        },
        {
          dataPath: '[0].value',
          keyword: 'additionalProperties',
          message: 'should NOT have additional properties',
          params: { additionalProperty: 'invalid' },
          schemaPath:
            '#/items/anyOf/1/properties/value/anyOf/1/additionalProperties',
        },
        {
          dataPath: '[0].value',
          keyword: 'anyOf',
          message: 'should match some schema in anyOf',
          params: {},
          schemaPath: '#/items/anyOf/1/properties/value/anyOf',
        },
        {
          dataPath: '[0]',
          keyword: 'anyOf',
          message: 'should match some schema in anyOf',
          params: {},
          schemaPath: '#/items/anyOf',
        },
      ],
      hasSchema
    );
  });
  test('should validate mitigate property in route configuration', () => {
    const routes: Route[] = [
      {
        src: '/api/protected/(.*)',
        mitigate: {
          action: 'challenge',
        },
      },
      {
        src: '/api/testy/(.*)',
        mitigate: {
          action: 'deny',
        },
      },
    ];

    assertValid(routes, routesSchema);
  });

  test('should fail validation for invalid mitigate action', () => {
    const routes: Route[] = [
      {
        src: '/api/protected/(.*)',
        mitigate: {
          // @ts-expect-error - invalid action
          action: 'invalid',
        },
      },
    ];

    assertError(
      routes,
      [
        {
          dataPath: '[0].mitigate.action',
          keyword: 'enum',
          message: 'should be equal to one of the allowed values',
          params: {
            allowedValues: ['challenge', 'deny'],
          },
          schemaPath:
            '#/items/anyOf/0/properties/mitigate/properties/action/enum',
        },
        {
          dataPath: '[0]',
          keyword: 'additionalProperties',
          message: 'should NOT have additional properties',
          params: { additionalProperty: 'src' },
          schemaPath: '#/items/anyOf/1/additionalProperties',
        },
        {
          dataPath: '[0]',
          keyword: 'anyOf',
          message: 'should match some schema in anyOf',
          params: {},
          schemaPath: '#/items/anyOf',
        },
      ],
      routesSchema
    );
  });

  test('should validate basic transforms property in route configuration', () => {
    const routes: Route[] = [
      {
        src: '/api/(.*)',
        transforms: [
          {
            type: 'request.headers',
            op: 'set',
            target: {
              key: 'x-forwarded-proto',
            },
            args: 'https',
          },
        ],
      },
    ];

    assertValid(routes, routesSchema);
  });

  test('should fail validation for transforms with regex property', () => {
    const routes: Route[] = [
      {
        src: '/api/(.*)',
        transforms: [
          {
            type: 'request.headers',
            op: 'set',
            target: {
              // @ts-expect-error - re is not currently supported for transforms
              key: { re: '^x-.*' },
            },
            args: 'value',
          },
        ],
      },
    ];

    assertError(
      routes,
      [
        {
          dataPath: '[0].transforms[0].target.key',
          keyword: 'type',
          message: 'should be string',
          params: { type: 'string' },
          schemaPath:
            '#/items/anyOf/0/properties/transforms/items/properties/target/properties/key/anyOf/0/type',
        },
        {
          dataPath: '[0].transforms[0].target.key',
          keyword: 'additionalProperties',
          message: 'should NOT have additional properties',
          params: { additionalProperty: 're' },
          schemaPath:
            '#/items/anyOf/0/properties/transforms/items/properties/target/properties/key/anyOf/1/additionalProperties',
        },
        {
          dataPath: '[0].transforms[0].target.key',
          keyword: 'anyOf',
          message: 'should match some schema in anyOf',
          params: {},
          schemaPath:
            '#/items/anyOf/0/properties/transforms/items/properties/target/properties/key/anyOf',
        },
        {
          dataPath: '[0]',
          keyword: 'additionalProperties',
          message: 'should NOT have additional properties',
          params: { additionalProperty: 'src' },
          schemaPath: '#/items/anyOf/1/additionalProperties',
        },
        {
          dataPath: '[0]',
          keyword: 'anyOf',
          message: 'should match some schema in anyOf',
          params: {},
          schemaPath: '#/items/anyOf',
        },
      ],
      routesSchema
    );
  });

  test('should validate transforms with non-regex MatchableValue properties', () => {
    const routes: Route[] = [
      {
        src: '/api/(.*)',
        transforms: [
          {
            type: 'request.headers',
            op: 'set',
            target: {
              key: { eq: 'x-custom-header' },
            },
            args: 'value',
          },
          {
            type: 'request.query',
            op: 'append',
            target: {
              key: { pre: 'utm_' },
            },
            args: ['source', 'medium'],
          },
          {
            type: 'response.headers',
            op: 'delete',
            target: {
              key: { inc: ['server', 'x-powered-by'] },
            },
          },
        ],
      },
    ];

    assertValid(routes, routesSchema);
  });

  test('it should reject when transforms is an empty array', () => {
    const routes: Route[] = [
      {
        src: '/api/(.*)',
        transforms: [],
      },
    ];

    assertError(routes, [
      {
        dataPath: '[0].transforms',
        keyword: 'minItems',
        message: 'should NOT have fewer than 1 items',
        params: { limit: 1 },
        schemaPath: '#/items/anyOf/0/properties/transforms/minItems',
      },
      {
        dataPath: '[0]',
        keyword: 'additionalProperties',
        message: 'should NOT have additional properties',
        params: { additionalProperty: 'src' },
        schemaPath: '#/items/anyOf/1/additionalProperties',
      },
      {
        dataPath: '[0]',
        keyword: 'anyOf',
        message: 'should match some schema in anyOf',
        params: {},
        schemaPath: '#/items/anyOf',
      },
    ]);
  });

  test('should fail validation when transforms is not an array', () => {
    const routes: Route[] = [
      {
        src: '/api/(.*)',
        // @ts-expect-error - not an array
        transforms: 'not-an-array',
      },
    ];

    assertError(
      routes,
      [
        {
          dataPath: '[0].transforms',
          keyword: 'type',
          message: 'should be array',
          params: { type: 'array' },
          schemaPath: '#/items/anyOf/0/properties/transforms/type',
        },
        {
          dataPath: '[0]',
          keyword: 'additionalProperties',
          message: 'should NOT have additional properties',
          params: { additionalProperty: 'src' },
          schemaPath: '#/items/anyOf/1/additionalProperties',
        },
        {
          dataPath: '[0]',
          keyword: 'anyOf',
          message: 'should match some schema in anyOf',
          params: {},
          schemaPath: '#/items/anyOf',
        },
      ],
      routesSchema
    );
  });

  test('should fail validation when transform is missing required properties', () => {
    const routes: Route[] = [
      {
        src: '/api/(.*)',
        transforms: [
          // @ts-expect-error - missing required properties
          {
            args: 'value',
          },
        ],
      },
    ];

    assertError(
      routes,
      [
        {
          dataPath: '[0].transforms[0]',
          keyword: 'required',
          message: "should have required property 'type'",
          params: { missingProperty: 'type' },
          schemaPath: '#/items/anyOf/0/properties/transforms/items/required',
        },
        {
          dataPath: '[0]',
          keyword: 'additionalProperties',
          message: 'should NOT have additional properties',
          params: { additionalProperty: 'src' },
          schemaPath: '#/items/anyOf/1/additionalProperties',
        },
        {
          dataPath: '[0]',
          keyword: 'anyOf',
          message: 'should match some schema in anyOf',
          params: {},
          schemaPath: '#/items/anyOf',
        },
      ],
      routesSchema
    );
  });

  test('it should reject when transforms try to set a header with invalid key characters', () => {
    const routes: Route[] = [
      {
        src: '/api/(.*)',
        transforms: [
          {
            type: 'request.headers',
            op: 'set',
            target: {
              key: '^x-.*',
            },
            args: 'valid-value',
          },
          {
            type: 'request.headers',
            op: 'set',
            target: {
              key: '🚀',
            },
            args: 'valid-value',
          },
        ],
      },
    ];

    assertError(routes, [
      {
        dataPath: '[0].transforms[0].target.key',
        keyword: 'pattern',
        message: 'should match pattern "^[a-zA-Z0-9_-]+$"',
        params: { pattern: '^[a-zA-Z0-9_-]+$' },
        schemaPath:
          '#/items/anyOf/0/properties/transforms/items/allOf/1/then/properties/target/properties/key/then/pattern',
      },
      {
        dataPath: '[0].transforms[0].target.key',
        keyword: 'if',
        message: 'should match "then" schema',
        params: { failingKeyword: 'then' },
        schemaPath:
          '#/items/anyOf/0/properties/transforms/items/allOf/1/then/properties/target/properties/key/if',
      },
      {
        dataPath: '[0].transforms[0]',
        keyword: 'if',
        message: 'should match "then" schema',
        params: { failingKeyword: 'then' },
        schemaPath: '#/items/anyOf/0/properties/transforms/items/allOf/1/if',
      },
      {
        dataPath: '[0]',
        keyword: 'additionalProperties',
        message: 'should NOT have additional properties',
        params: { additionalProperty: 'src' },
        schemaPath: '#/items/anyOf/1/additionalProperties',
      },
      {
        dataPath: '[0]',
        keyword: 'anyOf',
        message: 'should match some schema in anyOf',
        params: {},
        schemaPath: '#/items/anyOf',
      },
    ]);
  });

  test('it should reject when transforms try to set a header with invalid value characters', () => {
    const routes: Route[] = [
      {
        src: '/api/(.*)',
        transforms: [
          {
            type: 'request.headers',
            op: 'set',
            target: {
              key: 'x-custom-header',
            },
            args: '\\\\\\n',
          },
        ],
      },
      {
        src: '/api/(.*)',
        transforms: [
          {
            type: 'request.headers',
            op: 'set',
            target: {
              key: 'x-custom-header',
            },
            args: '🚀',
          },
        ],
      },
      {
        src: '/api/(.*)',
        transforms: [
          {
            type: 'request.headers',
            op: 'set',
            target: {
              key: 'x-custom-header',
            },
            args: ['🚀'],
          },
        ],
      },
      {
        src: '/api/(.*)',
        transforms: [
          {
            type: 'request.headers',
            op: 'set',
            target: {
              key: 'x-custom-header',
            },
            args: 'forbidden©chars',
          },
        ],
      },
      {
        src: '/api/(.*)',
        transforms: [
          {
            type: 'request.headers',
            op: 'set',
            target: {
              key: 'x-custom-header',
            },
            args: 'carriage\rreturnand\nnewlineand\ttab',
          },
        ],
      },
      {
        src: '/api/(.*)',
        transforms: [
          {
            type: 'request.headers',
            op: 'set',
            target: {
              key: 'x-custom-header',
            },
            args: '',
          },
        ],
      },
    ];

    assertError(routes, [
      {
        dataPath: '[0].transforms[0].args',
        keyword: 'pattern',
        message:
          'should match pattern "^[a-zA-Z0-9_ :;.,"\'?!(){}\\[\\]@<>=+*#$&`|~\\^%/-]+$"',
        params: {
          pattern: '^[a-zA-Z0-9_ :;.,"\'?!(){}\\[\\]@<>=+*#$&`|~\\^%/-]+$',
        },
        schemaPath:
          '#/items/anyOf/0/properties/transforms/items/allOf/1/then/properties/args/anyOf/0/pattern',
      },
      {
        dataPath: '[0].transforms[0].args',
        keyword: 'type',
        message: 'should be array',
        params: { type: 'array' },
        schemaPath:
          '#/items/anyOf/0/properties/transforms/items/allOf/1/then/properties/args/anyOf/1/type',
      },
      {
        dataPath: '[0].transforms[0].args',
        keyword: 'anyOf',
        message: 'should match some schema in anyOf',
        params: {},
        schemaPath:
          '#/items/anyOf/0/properties/transforms/items/allOf/1/then/properties/args/anyOf',
      },
      {
        dataPath: '[0].transforms[0]',
        keyword: 'if',
        message: 'should match "then" schema',
        params: { failingKeyword: 'then' },
        schemaPath: '#/items/anyOf/0/properties/transforms/items/allOf/1/if',
      },
      {
        dataPath: '[0]',
        keyword: 'additionalProperties',
        message: 'should NOT have additional properties',
        params: { additionalProperty: 'src' },
        schemaPath: '#/items/anyOf/1/additionalProperties',
      },
      {
        dataPath: '[0]',
        keyword: 'anyOf',
        message: 'should match some schema in anyOf',
        params: {},
        schemaPath: '#/items/anyOf',
      },
    ]);
  });

  test('it should fail validation when missing the target key', () => {
    const routes: Route[] = [
      {
        src: '/api/(.*)',
        transforms: [
          // @ts-expect-error - missing required properties
          {
            type: 'request.headers',
            op: 'set',
            args: 'value',
          },
        ],
      },
    ];

    assertError(routes, [
      {
        dataPath: '[0].transforms[0]',
        keyword: 'required',
        message: "should have required property 'target'",
        params: { missingProperty: 'target' },
        schemaPath: '#/items/anyOf/0/properties/transforms/items/required',
      },
      {
        dataPath: '[0]',
        keyword: 'additionalProperties',
        message: 'should NOT have additional properties',
        params: { additionalProperty: 'src' },
        schemaPath: '#/items/anyOf/1/additionalProperties',
      },
      {
        dataPath: '[0]',
        keyword: 'anyOf',
        message: 'should match some schema in anyOf',
        params: {},
        schemaPath: '#/items/anyOf',
      },
    ]);
  });

  test('it should fail validation when missing the target key, key', () => {
    const routes: Route[] = [
      {
        src: '/api/(.*)',
        transforms: [
          {
            type: 'request.headers',
            op: 'set',
            // @ts-expect-error - missing required properties
            target: {},
            args: 'value',
          },
        ],
      },
    ];

    assertError(routes, [
      {
        dataPath: '[0].transforms[0].target',
        keyword: 'required',
        message: "should have required property 'key'",
        params: { missingProperty: 'key' },
        schemaPath:
          '#/items/anyOf/0/properties/transforms/items/properties/target/required',
      },
      {
        dataPath: '[0]',
        keyword: 'additionalProperties',
        message: 'should NOT have additional properties',
        params: { additionalProperty: 'src' },
        schemaPath: '#/items/anyOf/1/additionalProperties',
      },
      {
        dataPath: '[0]',
        keyword: 'anyOf',
        message: 'should match some schema in anyOf',
        params: {},
        schemaPath: '#/items/anyOf',
      },
    ]);
  });

  test('it should fail validation when invalid type for enum values', () => {
    const routes: Route[] = [
      {
        src: '/api/(.*)',
        transforms: [
          {
            // @ts-expect-error - invalid type
            type: 'invalid.headers',
            op: 'set',
            target: {
              key: 'x-custom-header',
            },
            args: 'value',
          },
        ],
      },
    ];

    assertError(routes, [
      {
        dataPath: '[0].transforms[0].type',
        keyword: 'enum',
        message: 'should be equal to one of the allowed values',
        params: {
          allowedValues: [
            'request.headers',
            'request.query',
            'response.headers',
          ],
        },
        schemaPath:
          '#/items/anyOf/0/properties/transforms/items/properties/type/enum',
      },
      {
        dataPath: '[0]',
        keyword: 'additionalProperties',
        message: 'should NOT have additional properties',
        params: { additionalProperty: 'src' },
        schemaPath: '#/items/anyOf/1/additionalProperties',
      },
      {
        dataPath: '[0]',
        keyword: 'anyOf',
        message: 'should match some schema in anyOf',
        params: {},
        schemaPath: '#/items/anyOf',
      },
    ]);
  });
});
