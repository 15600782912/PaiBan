"""Smoke the real migrated database and Uvicorn factory, not just TestClient."""
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time

import httpx


def test_migrated_production_process_serves_health_and_protects_api(tmp_path):
    backend = Path(__file__).resolve().parents[1]
    env = {**os.environ, 'ZHUBO_DATABASE_URL': f"sqlite:///{tmp_path / 'runtime.db'}",
           'ZHUBO_JWT_SECRET': secrets.token_urlsafe(48), 'ZHUBO_ENVIRONMENT': 'production'}
    result = subprocess.run([sys.executable,'-m','alembic','upgrade','head'],cwd=backend,env=env,
                            capture_output=True,text=True,timeout=20)
    assert result.returncode == 0, result.stderr
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0))
        port = sock.getsockname()[1]
    process = subprocess.Popen([sys.executable,'-m','uvicorn','app.main:create_app','--factory','--host','127.0.0.1',
        '--port',str(port)],cwd=backend,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0)
    try:
        with httpx.Client(base_url=f'http://127.0.0.1:{port}',timeout=1,trust_env=False) as client:
            deadline=time.monotonic()+15
            while True:
                try:
                    response=client.get('/health')
                    break
                except httpx.TransportError:
                    if time.monotonic()>deadline or process.poll() is not None:
                        raise AssertionError('Uvicorn did not become ready')
                    time.sleep(0.1)
            assert response.status_code==200 and response.json()=={'status':'ok'}
            assert client.get('/api/v1/work-logs').status_code==401
            assert client.get('/docs').status_code==404
    finally:
        process.terminate()
        try:
            output=process.communicate(timeout=5)[0]
        except subprocess.TimeoutExpired:
            process.kill()
            output=process.communicate(timeout=5)[0]
        assert b'Traceback' not in output, output.decode(errors='replace')
