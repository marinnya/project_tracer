/*
  Warnings:

  - A unique constraint covering the columns `[oneCId]` on the table `Project` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[oneCId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "oneCId" TEXT,
ADD COLUMN     "responsibleId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "oneCId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Project_oneCId_key" ON "Project"("oneCId");

-- CreateIndex
CREATE UNIQUE INDEX "User_oneCId_key" ON "User"("oneCId");
