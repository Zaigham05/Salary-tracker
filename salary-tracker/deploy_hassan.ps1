# MR HASSAN | DEPLOYMENT SCRIPT 🚀
# This script will deploy your hub to Vercel instantly.

# 1. Check if Vercel CLI is installed
if (!(Get-Command vercel -ErrorAction SilentlyContinue)) {
    Write-Host "Vercel CLI not found. Please run: npm install -g vercel" -ForegroundColor Red
    exit
}

# 2. Deploy
Write-Host "Initiating Cloud Deployment for MR HASSAN..." -ForegroundColor Cyan
vercel deploy --prod --yes

Write-Host "Deployment Complete! Check your Vercel Dashboard." -ForegroundColor Green
Pause
