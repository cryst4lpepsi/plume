"""Spatiotemporal graph network in plain PyTorch (no PyG).

GRU over each station's 48 h window -> gated-attention message passing over the station graph ->
MLP decoder to 24 horizons x 3 quantiles (P50 plus positive offsets, so quantiles cannot cross)."""
import torch
import torch.nn as nn
import torch.nn.functional as F
from .config import HORIZON

N_FEAT = 12


class MPLayer(nn.Module):
    def __init__(self, h, e_dim):
        super().__init__()
        self.msg = nn.Linear(h, h)
        self.att = nn.Sequential(nn.Linear(2 * h + e_dim, h), nn.GELU(), nn.Linear(h, 1))
        self.gate = nn.Sequential(nn.Linear(e_dim, 32), nn.GELU(), nn.Linear(32, 1))  # edge features only
        self.upd = nn.Sequential(nn.Linear(2 * h, h), nn.GELU(), nn.Linear(h, h))
        self.norm = nn.LayerNorm(h)

    def forward(self, h, e, src, dst):
        """h [B,N,H], e [B,E,De]. Returns new h and the effective edge weight a*g [B,E]."""
        B, N, H = h.shape
        hs, hd = h[:, src], h[:, dst]
        s = self.att(torch.cat([hd, hs, e], -1)).squeeze(-1)                     # [B,E]
        idx = dst.unsqueeze(0).expand(B, -1)
        smax = torch.full((B, N), -1e9, device=h.device).scatter_reduce(1, idx, s, "amax", include_self=True)
        ex = torch.exp(s - smax.gather(1, idx))
        den = torch.zeros(B, N, device=h.device).scatter_add(1, idx, ex)
        a = ex / den.gather(1, idx).clamp_min(1e-9)                              # softmax over incoming edges
        g = torch.sigmoid(self.gate(e)).squeeze(-1)
        w = a * g
        agg = torch.zeros(B, N, H, device=h.device).index_add_(1, dst, w.unsqueeze(-1) * self.msg(hs))
        return self.norm(h + self.upd(torch.cat([h, agg], -1))), w


class PlumeNet(nn.Module):
    def __init__(self, hidden=64, layers=2, mode="wind"):
        """mode: 'none' (no message passing), 'dist' (distance + bearing edges), 'wind' (plus dynamic wind)."""
        super().__init__()
        self.mode, self.hidden = mode, hidden
        self.gru = nn.GRU(N_FEAT, hidden, batch_first=True)
        self.node = nn.Sequential(nn.Linear(hidden + 5, hidden), nn.GELU())
        e_dim = {"none": 0, "dist": 3, "wind": 6}[mode]
        self.mp = nn.ModuleList([MPLayer(hidden, e_dim) for _ in range(layers if mode != "none" else 0)])
        self.dec = nn.Sequential(nn.Linear(hidden + 3, 2 * hidden), nn.GELU(), nn.Linear(2 * hidden, HORIZON * 3))

    def forward(self, x, static, anchor, has, age, g, wind=None):
        """x [B,N,L,F]; static [N,2]; anchor/has/age [B,N]; g: dict(src,dst,e_static [E,3], sinb, cosb);
        wind [B,N,6] node wind summaries. Returns quantiles in z space [B,N,24,3] and last-layer edge weights."""
        B, N, L, Fd = x.shape
        _, hT = self.gru(x.reshape(B * N, L, Fd))
        extra = torch.stack([anchor, has, age], -1)
        h = self.node(torch.cat([hT.view(B, N, -1), static.unsqueeze(0).expand(B, -1, -1), extra], -1))
        w = None
        if self.mp:
            e = g["e_static"].unsqueeze(0).expand(B, -1, -1)
            if self.mode == "wind":
                ws = wind[:, g["src"]]                                           # [B,E,6]
                along = torch.stack([ws[..., 2 * k] * g["sinb"] + ws[..., 2 * k + 1] * g["cosb"] for k in range(3)], -1)
                e = torch.cat([e, along / 5.0], -1)                              # wind component toward dst, m/s / 5
            for layer in self.mp:
                h, w = layer(h, e, g["src"], g["dst"])
        o = self.dec(torch.cat([h, extra], -1)).view(B, N, HORIZON, 3)
        p50 = anchor.unsqueeze(-1) + o[..., 0]
        return torch.stack([p50 - F.softplus(o[..., 1]), p50, p50 + F.softplus(o[..., 2])], -1), w


def pinball(q_pred, y, mask, quantiles=(0.1, 0.5, 0.9)):
    """Mean pinball loss over masked targets. q_pred [...,3], y [...], mask bool."""
    q = torch.tensor(quantiles, device=y.device)
    d = y.unsqueeze(-1) - q_pred
    l = torch.maximum(q * d, (q - 1) * d).sum(-1)
    return (l * mask).sum() / mask.sum().clamp_min(1)
