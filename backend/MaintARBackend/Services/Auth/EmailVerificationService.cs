using System.Security.Cryptography;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using MaintARBackend.Context;
using MaintARBackend.Models;

namespace MaintARBackend.Services.Auth;

public interface IEmailVerificationService
{
    Task<string> GenerateCodeAsync(User user);
    Task<bool> VerifyCodeAsync(User user, string code);
}

internal sealed class EmailVerificationService : IEmailVerificationService
{
    private static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(15);

    private readonly AppDbContext _db;
    private readonly IPasswordService _passwordService;

    public EmailVerificationService(AppDbContext db, IPasswordService passwordService)
    {
        _db = db;
        _passwordService = passwordService;
    }

    public async Task<string> GenerateCodeAsync(User user)
    {
        var code = RandomNumberGenerator.GetInt32(100000, 999999).ToString();
        var hash = _passwordService.HashPassword(user, code);
        var expiresAt = DateTime.UtcNow.Add(CodeLifetime);

        var existing = await _db.EmailVerificationCodes
            .FirstOrDefaultAsync(e => e.UserId == user.Id);

        if (existing != null)
        {
            existing.CodeHash = hash;
            existing.ExpiresAt = expiresAt;
        }
        else
        {
            _db.EmailVerificationCodes.Add(new EmailVerificationCodeModel
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
        var entry = await _db.EmailVerificationCodes
            .FirstOrDefaultAsync(e => e.UserId == user.Id);

        if (entry == null || entry.ExpiresAt < DateTime.UtcNow)
        {
            return false;
        }

        var result = _passwordService.VerifyPassword(user, entry.CodeHash, code);

        if (result == PasswordVerificationResult.Failed)
        {
            return false;
        }

        user.IsEmailVerified = true;
        _db.EmailVerificationCodes.Remove(entry);

        await _db.SaveChangesAsync();

        return true;
    }
}
