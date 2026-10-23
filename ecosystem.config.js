module.exports = {
  apps: [
    {
      name: 'smartassur-backend',
      // Répertoire de travail = backend/ : appsettings.Local.json y est lu, et il fixe la clé
      // Data Protection des IMEI chiffrés (ne pas le changer une fois des dossiers enregistrés).
      cwd: '/www/wwwroot/detecter-mon-smartphone/backend',
      script: 'dotnet',
      args: 'bin/Debug/net8.0/SmartAssur.Api.dll',
      interpreter: 'none',
      env: {
        ASPNETCORE_ENVIRONMENT: 'Production',
        ASPNETCORE_URLS: 'http://127.0.0.1:5050'
      },
      restart_delay: 2000,
      autorestart: true
    },
    {
      name: 'smartassur-frontend',
      cwd: '/www/wwwroot/detecter-mon-smartphone/frontend',
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'production',
        PORT: 3050
      },
      restart_delay: 2000,
      autorestart: true
    },
    {
      name: 'smartassur-antigravity',
      cwd: '/www/wwwroot/detecter-mon-smartphone/backend/antigravity-service',
      script: '/www/wwwroot/detecter-mon-smartphone/backend/antigravity-service/.venv/bin/uvicorn',
      interpreter: 'none',
      args: 'app:app --host 127.0.0.1 --port 5060',
      env: {
        SMARTASSUR_UPLOAD_ROOT: '/www/wwwroot/detecter-mon-smartphone/backend/storage/uploads'
      },
      restart_delay: 3000,
      autorestart: true
    }
  ]
};

