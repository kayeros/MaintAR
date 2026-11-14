using System.Security.Cryptography;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using MaintARBackend.Context;
using MaintARBackend.Models;

namespace MaintARBackend.Services.Auth;

public interface IPasswordResetService
{
    Task<string> GenerateCodeAsync(User user);

    Task<bool> VerifyCodeAsync(User user, string code);

    Task ResetPasswordAsync(User user, string newPassword);
}

internal sealed class PasswordResetService : IPasswordResetService
{
    private static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(15);

    private readonly AppDbContext _db;
    private readonly IPasswordService _passwordService;

    public PasswordResetService(AppDbContext db, IPasswordService passwordService)
    {
        _db = db;
        _passwordService = passwordService;
    }

    public async Task<string> GenerateCodeAsync(User user)
    {
        var code = RandomNumberGenerator.GetInt32(100000, 999999).ToString();
        var hash = _passwordService.HashPassword(user, code);
        var expiresAt = DateTime.UtcNow.Add(CodeLifetime);

        var existing = await _db.ResetPasswordCodes
            .FirstOrDefaultAsync(r => r.UserId == user.Id);

        if (existing != null)
        {
            existing.CodeHash = hash;
            existing.ExpiresAt = expiresAt;
        }
        else
        {
            _db.ResetPasswordCodes.Add(new ResetPasswordCodeModel
            {
                UserId = user.Id,
                CodeHash = hash,
                ExpiresAt = expiresAt
            });
        }

        await _db.SaveChangesAsync();

        return code;
    }

    public async Task<bool> VerifyCodeAsync(User user, string code)
    {
        var entry = await _db.ResetPasswordCodes
            .FirstOrDefaultAsync(r => r.UserId == user.Id);

        if (entry == null || entry.ExpiresAt < DateTime.UtcNow)
        {
            return false;
        }

        var result = _passwordService.VerifyPassword(user, entry.CodeHash, code);

        return result != PasswordVerificationResult.Failed;
    }

    public async Task ResetPasswordAsync(User user, string newPassword)
    {
        user.PasswordHash = _passwordService.HashPassword(user, newPassword);

        var entry = await _db.ResetPasswordCodes
            .FirstOrDefaultAsync(r => r.UserId == user.Id);

        if (entry != null)
        {
            _db.ResetPasswordCodes.Remove(entry);
        }

        await _db.SaveChangesAsync();
    }
}
