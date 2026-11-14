using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MaintARBackend.Migrations;

/// <inheritdoc />
public partial class _20261114145535_SplitCodesLikeNeuronBackend : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(
            name: "VerificationCodes");

        migrationBuilder.CreateTable(
            name: "EmailVerificationCodes",
            columns: table => new
            {
                Id = table.Column<int>(type: "int", nullable: false)
                    .Annotation("SqlServer:Identity", "1, 1"),
                UserId = table.Column<int>(type: "int", nullable: false),
                CodeHash = table.Column<string>(type: "nvarchar(max)", nullable: false),
                ExpiresAt = table.Column<DateTime>(type: "datetime2", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_EmailVerificationCodes", x => x.Id);
                table.ForeignKey(
                    name: "FK_EmailVerificationCodes_Users_UserId",
                    column: x => x.UserId,
                    principalTable: "Users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateTable(
            name: "ResetPasswordCodes",
            columns: table => new
            {
                Id = table.Column<int>(type: "int", nullable: false)
                    .Annotation("SqlServer:Identity", "1, 1"),
                UserId = table.Column<int>(type: "int", nullable: false),
                CodeHash = table.Column<string>(type: "nvarchar(max)", nullable: false),
                ExpiresAt = table.Column<DateTime>(type: "datetime2", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_ResetPasswordCodes", x => x.Id);
                table.ForeignKey(
                    name: "FK_ResetPasswordCodes_Users_UserId",
                    column: x => x.UserId,
                    principalTable: "Users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "IX_EmailVerificationCodes_UserId",
            table: "EmailVerificationCodes",
            column: "UserId",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_ResetPasswordCodes_UserId",
            table: "ResetPasswordCodes",
            column: "UserId",
            unique: true);
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(
            name: "EmailVerificationCodes");

        migrationBuilder.DropTable(
            name: "ResetPasswordCodes");

        migrationBuilder.CreateTable(
            name: "VerificationCodes",
            columns: table => new
            {
                Id = table.Column<int>(type: "int", nullable: false)
                    .Annotation("SqlServer:Identity", "1, 1"),
                UserId = table.Column<int>(type: "int", nullable: false),
                CodeHash = table.Column<string>(type: "nvarchar(max)", nullable: false),
                ExpiresAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                FailedAttempts = table.Column<int>(type: "int", nullable: false),
                Purpose = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                SentAt = table.Column<DateTime>(type: "datetime2", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_VerificationCodes", x => x.Id);
                table.ForeignKey(
                    name: "FK_VerificationCodes_Users_UserId",
                    column: x => x.UserId,
                    principalTable: "Users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "IX_VerificationCodes_UserId_Purpose",
            table: "VerificationCodes",
            columns: new[] { "UserId", "Purpose" },
            unique: true);
    }
}
