module.exports = {
  apps: [
    {
      name: 'smartassur-backend',
      cwd: '/www/wwwroot/SMARTASSUR_MOBILE/backend/publish',
      script: 'dotnet',
      args: '/www/wwwroot/SMARTASSUR_MOBILE/backend/publish/SmartAssur.Api.dll',
      env: {
        ASPNETCORE_ENVIRONMENT: 'Development',
        ASPNETCORE_URLS: 'http://0.0.0.0:5050'
      },
      restart_delay: 2000,
      autorestart: true
    },
    {
      name: 'smartassur-frontend',
      cwd: '/www/wwwroot/SMARTASSUR_MOBILE/frontend',
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
      cwd: '/www/wwwroot/SMARTASSUR_MOBILE/backend/antigravity-service',
      script: '/www/wwwroot/SMARTASSUR_MOBILE/backend/antigravity-service/.venv/bin/uvicorn',
      interpreter: 'none',
      args: 'app:app --host 127.0.0.1 --port 5060',
      env: {
        SMARTASSUR_UPLOAD_ROOT: '/www/wwwroot/SMARTASSUR_MOBILE/backend/storage/uploads'
      },
      restart_delay: 3000,
      autorestart: true
    }
  ]
};

