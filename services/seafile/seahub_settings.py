import os

_domain = os.environ.get('SEAFILE_SERVER_HOSTNAME', '')
SERVICE_URL = f'https://{_domain}'
FILE_SERVER_ROOT = f'https://{_domain}/seafhttp'
CSRF_TRUSTED_ORIGINS = [f'https://{_domain}']
