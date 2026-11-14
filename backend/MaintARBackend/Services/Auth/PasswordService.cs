using Microsoft.AspNetCore.Identity;
using MaintARBackend.Models;

namespace MaintARBackend.Services.Auth;

public interface IPasswordService
{
    string HashPassword(User user, string password);

    PasswordVerificationResult VerifyPassword(User user, string hashedPassword, string providedPassword);
}

internal sealed class PasswordService : IPasswordService
{
    private readonly PasswordHasher<User> _passwordHasher = new();

    public string HashPassword(User user, string password)
    {
        return _passwordHasher.HashPassword(user, password);
    }

    public PasswordVerificationResult VerifyPassword(User user, string hashedPassword, string providedPassword)
    {
        return _passwordHasher.VerifyHashedPassword(user, hashedPassword, providedPassword);
    }
}
