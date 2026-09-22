import express, { Request, Response } from 'express';
import path from 'path';
import { spawn, execFile, ChildProcess } from 'child_process';
import { createServer as createViteServer } from 'vite';

interface ActiveStreamInfo {
  process: ChildProcess;
  pid: number | undefined;
  startTime: number;
  command: string;
  args: string[];
  logs: string[];
  lastError: string | null;
  isRunning: boolean;
}

let activeStream: ActiveStreamInfo | null = null;

// Helper to find working python binary (python3 or python)
function resolvePythonBinary(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('python3', ['--version'], (err) => {
      if (!err) {
        return resolve('python3');
      }
      execFile('python', ['--version'], (err2) => {
        if (!err2) {
          return resolve('python');
        }
        resolve(null);
      });
    });
  });
}

// Helper to probe Python dependencies
function probePythonEnvironment(pythonBin: string): Promise<{
  pythonFound: boolean;
  pythonVersion: string;
  opencvInstalled: boolean;
  numpyInstalled: boolean;
  reedsoloInstalled: boolean;
  pillowInstalled: boolean;
  missingPackages: string[];
  installCommand: string;
}> {
  return new Promise((resolve) => {
    const probeScript = `
import sys
import json

info = {
    "pythonVersion": sys.version.split()[0],
    "cv2": False,
    "numpy": False,
    "reedsolo": False,
    "PIL": False
}

try:
    import cv2
    info["cv2"] = True
except Exception:
    pass

try:
    import numpy
    info["numpy"] = True
except Exception:
    pass

try:
    import reedsolo
    info["reedsolo"] = True
except Exception:
    pass

try:
    import PIL
    info["PIL"] = True
except Exception:
    pass

print(json.dumps(info))
`;

    execFile(pythonBin, ['-c', probeScript], (err, stdout) => {
      if (err || !stdout) {
        return resolve({
          pythonFound: true,
          pythonVersion: 'Unknown',
          opencvInstalled: false,
          numpyInstalled: false,
          reedsoloInstalled: false,
          pillowInstalled: false,
          missingPackages: ['opencv-python', 'numpy', 'pillow', 'reedsolo'],
          installCommand: 'pip install opencv-python numpy pillow reedsolo',
        });
      }

      try {
        const parsed = JSON.parse(stdout.trim());
        const missing: string[] = [];
        if (!parsed.cv2) missing.push('opencv-python');
        if (!parsed.numpy) missing.push('numpy');
        if (!parsed.PIL) missing.push('pillow');
        if (!parsed.reedsolo) missing.push('reedsolo');

        resolve({
          pythonFound: true,
          pythonVersion: parsed.pythonVersion || '3.x',
          opencvInstalled: Boolean(parsed.cv2),
          numpyInstalled: Boolean(parsed.numpy),
          reedsoloInstalled: Boolean(parsed.reedsolo),
          pillowInstalled: Boolean(parsed.PIL),
          missingPackages: missing,
          installCommand: `pip install ${missing.length > 0 ? missing.join(' ') : 'opencv-python numpy pillow reedsolo'}`,
        });
      } catch {
        resolve({
          pythonFound: true,
          pythonVersion: '3.x',
          opencvInstalled: false,
          numpyInstalled: false,
          reedsoloInstalled: false,
          pillowInstalled: false,
          missingPackages: ['opencv-python', 'numpy', 'pillow', 'reedsolo'],
          installCommand: 'pip install opencv-python numpy pillow reedsolo',
        });
      }
    });
  });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --------------------------------------------------------------------------
  // API Endpoints
  // --------------------------------------------------------------------------

  // 1. Health & Server Status
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'Visual Data Codec Local Bridge',
      activeStream: activeStream?.isRunning ?? false,
    });
  });

  // 2. Check Python Environment & Dependencies
  app.get('/api/stream/check-env', async (req: Request, res: Response) => {
    const pythonBin = await resolvePythonBinary();
    if (!pythonBin) {
      return res.json({
        pythonFound: false,
        pythonVersion: null,
        opencvInstalled: false,
        numpyInstalled: false,
        reedsoloInstalled: false,
        pillowInstalled: false,
        missingPackages: ['python3', 'opencv-python', 'numpy', 'pillow', 'reedsolo'],
        installCommand: 'Install Python 3.8+ then run: pip install opencv-python numpy pillow reedsolo',
        message: 'Python 3 was not found in system PATH.',
      });
    }

    const envInfo = await probePythonEnvironment(pythonBin);
    return res.json({
      pythonBinary: pythonBin,
      ...envInfo,
    });
  });

  // 3. Get Active Stream Status & Recent Logs
  app.get('/api/stream/status', (req: Request, res: Response) => {
    if (!activeStream || !activeStream.isRunning) {
      return res.json({
        isRunning: false,
        pid: null,
        uptimeSeconds: 0,
        logs: activeStream?.logs?.slice(-50) || [],
        lastError: activeStream?.lastError || null,
        command: activeStream?.command || null,
      });
    }

    const uptimeSeconds = Math.round((Date.now() - activeStream.startTime) / 1000);
    return res.json({
      isRunning: true,
      pid: activeStream.pid,
      uptimeSeconds,
      startTime: activeStream.startTime,
      command: activeStream.command,
      logs: activeStream.logs.slice(-50),
      lastError: activeStream.lastError,
    });
  });

  // 4. Start Live Stream Decoder (Local Child Process)
  const handleStartStream = async (req: Request, res: Response) => {
    // If a stream is already running, check if it's actually alive
    if (activeStream && activeStream.isRunning) {
      return res.status(409).json({
        success: false,
        errorType: 'ALREADY_RUNNING',
        message: `Live stream decoder is already active with PID ${activeStream.pid}. Stop it first before starting a new window.`,
        pid: activeStream.pid,
      });
    }

    // Step A: Check Python binary
    const pythonBin = await resolvePythonBinary();
    if (!pythonBin) {
      return res.status(400).json({
        success: false,
        errorType: 'PYTHON_NOT_FOUND',
        message: 'Python 3 executable not found in your system PATH.',
        details: 'Please install Python 3.8+ from https://www.python.org/downloads/ and ensure it is added to your PATH.',
        installCommand: 'Download and install Python 3 (python.org)',
      });
    }

    // Step B: Probe environment for immediate feedback
    const envInfo = await probePythonEnvironment(pythonBin);
    if (!envInfo.opencvInstalled || !envInfo.numpyInstalled) {
      const missingList = envInfo.missingPackages.join(', ');
      return res.status(400).json({
        success: false,
        errorType: 'MISSING_DEPENDENCIES',
        missingPackages: envInfo.missingPackages,
        message: `Required Python package(s) missing: ${missingList}.`,
        details: `The OpenCV Live Stream decoder requires OpenCV and NumPy. Run: "${envInfo.installCommand}" in your terminal.`,
        installCommand: envInfo.installCommand,
      });
    }

    // Step C: Build command line arguments
    const {
      camera = '0',
      width = 1920,
      height = 1080,
      fps = 60,
      scale = 'auto',
      synthetic = false,
      headless = false,
      outputFile = 'restored_stream.txt',
      logFile = 'stream_metrics.csv',
      sha256,
      expectedSha256,
    } = req.body || {};

    const scriptPath = path.resolve(process.cwd(), 'live_stream_decoder.py');
    const args: string[] = [scriptPath];

    if (synthetic) {
      args.push('--test');
    } else {
      args.push('--camera', String(camera));
    }

    args.push('--width', String(width));
    args.push('--height', String(height));
    args.push('--fps', String(fps));

    if (scale && scale !== 'auto') {
      args.push('--scale', String(scale));
    }

    const targetSha = sha256 || expectedSha256;
    if (targetSha && typeof targetSha === 'string' && targetSha.trim().length > 0) {
      args.push('--sha256', targetSha.trim().toLowerCase());
    }

    if (headless) {
      args.push('--headless');
    }

    if (outputFile) {
      args.push('-o', String(outputFile));
    }

    if (logFile) {
      args.push('--log-file', String(logFile));
    }

    const commandStr = `${pythonBin} live_stream_decoder.py ${args.slice(1).join(' ')}`;
    const initialLogs: string[] = [`[BRIDGE] Spawning: ${commandStr}`];

    // Step D: Spawn child process
    let child: ChildProcess;
    try {
      child = spawn(pythonBin, args, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
        },
      });
    } catch (spawnErr) {
      const errMsg = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
      return res.status(500).json({
        success: false,
        errorType: 'SPAWN_FAILED',
        message: `Failed to spawn process: ${errMsg}`,
        details: errMsg,
      });
    }

    const streamState: ActiveStreamInfo = {
      process: child,
      pid: child.pid,
      startTime: Date.now(),
      command: commandStr,
      args,
      logs: initialLogs,
      lastError: null,
      isRunning: true,
    };
    activeStream = streamState;

    let hasResponded = false;
    let initialStderr = '';

    child.stdout?.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        streamState.logs.push(`[STDOUT] ${line}`);
      }
    });

    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      initialStderr += text;
      const lines = text.split('\n').filter(Boolean);
      for (const line of lines) {
        streamState.logs.push(`[STDERR] ${line}`);
      }
    });

    child.on('error', (err) => {
      streamState.isRunning = false;
      streamState.lastError = err.message;
      streamState.logs.push(`[PROCESS ERROR] ${err.message}`);

      if (!hasResponded) {
        hasResponded = true;
        return res.status(500).json({
          success: false,
          errorType: 'PROCESS_ERROR',
          message: `Process error: ${err.message}`,
          details: err.message,
        });
      }
    });

    child.on('exit', (code, signal) => {
      streamState.isRunning = false;
      const exitMsg = `Process exited with code ${code ?? 'null'} (signal: ${signal ?? 'none'})`;
      streamState.logs.push(`[EXIT] ${exitMsg}`);

      if (!hasResponded) {
        hasResponded = true;
        // Immediate failure on startup
        let errorType = 'EXIT_EARLY';
        let friendlyMessage = `Live stream script exited immediately (${exitMsg}).`;

        if (initialStderr.includes('OpenCV is required') || initialStderr.includes('No module named') && initialStderr.includes('cv2')) {
          errorType = 'MISSING_OPENCV';
          friendlyMessage = 'OpenCV (cv2) is not installed in your Python environment.';
        } else if (initialStderr.includes('numpy is required') || initialStderr.includes('No module named') && initialStderr.includes('numpy')) {
          errorType = 'MISSING_NUMPY';
          friendlyMessage = 'NumPy is not installed in your Python environment.';
        }

        return res.status(400).json({
          success: false,
          errorType,
          message: friendlyMessage,
          details: initialStderr || exitMsg,
          installCommand: 'pip install opencv-python numpy pillow reedsolo',
        });
      }
    });

    // Wait a brief 400ms to verify the process didn't immediately crash
    setTimeout(() => {
      if (!hasResponded) {
        hasResponded = true;
        if (streamState.isRunning) {
          return res.json({
            success: true,
            pid: child.pid,
            command: commandStr,
            message: headless
              ? 'Live stream decoder started in headless mode.'
              : 'OpenCV Live Stream window launched successfully!',
          });
        }
      }
    }, 450);
  };

  app.post('/api/start-stream', handleStartStream);
  app.post('/api/stream/start', handleStartStream);

  // 5. Stop Live Stream Decoder
  const handleStopStream = (req: Request, res: Response) => {
    if (!activeStream || !activeStream.isRunning || !activeStream.process) {
      return res.json({
        success: true,
        message: 'No live stream process is currently running.',
      });
    }

    try {
      activeStream.process.kill('SIGINT');
      setTimeout(() => {
        if (activeStream && activeStream.isRunning) {
          activeStream.process.kill('SIGKILL');
        }
      }, 1000);

      activeStream.isRunning = false;
      return res.json({
        success: true,
        message: `Live stream process (PID ${activeStream.pid}) stopped.`,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({
        success: false,
        message: `Failed to terminate process: ${errMsg}`,
      });
    }
  };

  app.post('/api/stop-stream', handleStopStream);
  app.post('/api/stream/stop', handleStopStream);

  // --------------------------------------------------------------------------
  // Vite Integration (Development Middleware / Production Static)
  // --------------------------------------------------------------------------
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[VCDC Server] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
