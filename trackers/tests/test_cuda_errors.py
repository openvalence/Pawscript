"""paw-58lg: a cuBLAS / cuDNN status is classified by what it means, not by its prefix. An allocation failure is an
out-of-memory (vram.run's unload-and-retry, then the "not enough GPU memory" words), an unsupported / bad input is a
plain job error, only an execution / mapping failure leaves the CUDA context broken (serve exits, the app restarts it).
Message strings as torch 2.x prints them. No GPU needed."""
import pytest

from pawtrack import serve, vram


class AcceleratorError(RuntimeError):   # torch >= 2.8 raises CUDA errors as torch.AcceleratorError
    pass


OOM, JOB, FATAL = "oom", "job", "fatal"
CASES = [
    ("CUDA error: CUBLAS_STATUS_ALLOC_FAILED when calling `cublasCreate(handle)`", OOM),
    ("CUDA error: CUBLAS_STATUS_NOT_INITIALIZED when calling `cublasCreate(handle)`", OOM),   # cuBLAS' handle had no memory
    ("cuDNN error: CUDNN_STATUS_ALLOC_FAILED", OOM),
    ("cuDNN error: CUDNN_STATUS_INTERNAL_ERROR", OOM),   # cuDNN's workspace allocation failing, most often
    ("cuDNN error: CUDNN_STATUS_NOT_SUPPORTED. This error may appear if you passed in a non-contiguous input.", JOB),
    ("CUDA error: CUBLAS_STATUS_NOT_SUPPORTED when calling `cublasGemmStridedBatchedEx(handle, opa, opb, ...)`", JOB),
    ("CUDA error: CUBLAS_STATUS_INVALID_VALUE when calling `cublasSgemm( handle, opa, opb, m, n, k, &alpha, a, lda, b, ldb, &beta, c, ldc)`", JOB),
    ("cuDNN error: CUDNN_STATUS_BAD_PARAM", JOB),
    ("CUDA error: CUBLAS_STATUS_INTERNAL_ERROR when calling `cublasLtMatmul( ltHandle, computeDesc.descriptor(), ...)`", JOB),
    ("CUDA error: CUBLAS_STATUS_EXECUTION_FAILED when calling `cublasSgemm( handle, opa, opb, m, n, k, ...)`", FATAL),
    ("cuDNN error: CUDNN_STATUS_EXECUTION_FAILED", FATAL),
    ("cuDNN error: CUDNN_STATUS_MAPPING_ERROR", FATAL),
    ("CUDA error: CUBLAS_STATUS_ARCH_MISMATCH when calling `cublasGemmEx(...)`", FATAL),
    ("CUDA error: an illegal memory access was encountered", FATAL),
    ("CUDA out of memory. Tried to allocate 2.00 GiB", OOM),
]


@pytest.mark.parametrize("msg, want", CASES)
@pytest.mark.parametrize("cls", [RuntimeError, AcceleratorError])
def test_classify(msg, want, cls):
    e = cls(msg)
    got = OOM if vram.is_oom(e) else FATAL if vram.is_fatal(e) else JOB
    assert got == want, msg


def test_wrapped_alloc_failure_is_not_fatal():
    try:
        try:
            raise RuntimeError(CASES[0][0])
        except RuntimeError as e:
            raise ValueError("tracking failed") from e
    except ValueError as e:
        assert not vram.is_fatal(e)


def test_alloc_failure_keeps_serve_and_says_memory(monkeypatch):
    out, exits = [], []
    monkeypatch.setattr(serve.os, "_exit", exits.append)
    monkeypatch.setattr(vram, "_cuda", lambda: None)

    def boom(req, emit):
        raise RuntimeError(CASES[0][0])
    svc = serve.Service(out.append)
    svc.commands = {"x": boom}
    svc.run(serve.Job("7", {"cmd": "x"}))
    assert exits == [] and out[0]["type"] == "error" and "restart" not in out[0]
    assert out[0]["message"].startswith("Not enough GPU memory"), out[0]["message"]
