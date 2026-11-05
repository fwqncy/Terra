"""The JS brain as a PyTorch module.

network.js computes `out = 1 if x @ W > b else 0` per level, with W shaped [input][output]. Here each level
is an nn.Linear with weight = W.T and bias = -b, so `linear(x) > 0` is the same decision. `hard=True`
reproduces the browser exactly (in float64); `hard=False` uses sigmoid units for gradient-based methods
(PPO), and exporting those weights gives the deterministic browser policy (sigmoid > 0.5 ⇔ step fires).
"""
from __future__ import annotations

import torch
from torch import nn

from .brain import SHAPE, param_count


class StepSTE(torch.autograd.Function):
    """Forward: the browser's step (z > 0). Backward: the sigmoid's slope (straight-through estimator)."""

    @staticmethod
    def forward(ctx, z):
        ctx.save_for_backward(z)
        return (z > 0).to(z.dtype)

    @staticmethod
    def backward(ctx, grad):
        (z,) = ctx.saved_tensors
        s = torch.sigmoid(z)
        return grad * s * (1 - s)


class StepNet(nn.Module):
    def __init__(self, shape=SHAPE):
        super().__init__()
        self.shape = tuple(shape)
        self.levels = nn.ModuleList(nn.Linear(a, b, dtype=torch.float64) for a, b in zip(self.shape[:-1], self.shape[1:]))

    def logits(self, x: torch.Tensor, straight_through: bool = False) -> torch.Tensor:
        """Pre-activation of the output level. Hidden levels step exactly as in the browser; with
        `straight_through`, gradients pass through each step as if it were a sigmoid (for PPO)."""
        x = x.to(torch.float64)
        for level in self.levels[:-1]:
            z = level(x)
            x = StepSTE.apply(z) if straight_through else (z > 0).to(torch.float64)
        return self.levels[-1](x)

    def forward(self, x: torch.Tensor, hard: bool = True) -> torch.Tensor:
        x = x.to(torch.float64)
        for i, level in enumerate(self.levels):
            z = level(x)
            x = (z > 0).to(torch.float64) if hard or i < len(self.levels) - 1 else torch.sigmoid(z)
        return x

    # ---- flat layout shared with C++ and the JS brain JSON ----
    def to_flat(self) -> torch.Tensor:
        parts = []
        for level in self.levels:
            parts.append(level.weight.detach().T.reshape(-1))
            parts.append(-level.bias.detach())
        return torch.cat(parts)

    @torch.no_grad()
    def load_flat(self, params) -> "StepNet":
        p = torch.as_tensor(params, dtype=torch.float64).reshape(-1)
        if p.numel() != param_count(self.shape):
            raise ValueError(f"expected {param_count(self.shape)} parameters, got {p.numel()}")
        at = 0
        for level, (a, b) in zip(self.levels, zip(self.shape[:-1], self.shape[1:])):
            level.weight.copy_(p[at : at + a * b].reshape(a, b).T)
            at += a * b
            level.bias.copy_(-p[at : at + b])
            at += b
        return self

    @classmethod
    def from_flat(cls, params, shape=SHAPE) -> "StepNet":
        return cls(shape).load_flat(params)
