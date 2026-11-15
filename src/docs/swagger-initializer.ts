export const SWAGGER_INITIALIZER = `window.onload = function () {
  window.ui = SwaggerUIBundle({
    url: '/api/openapi.json',
    dom_id: '#swagger-ui',
    deepLinking: true,
    displayRequestDuration: true,
    tryItOutEnabled: true,
    validatorUrl: null,
    persistAuthorization: false,
    defaultModelsExpandDepth: -1,
    docExpansion: 'list'
  });
};`;
